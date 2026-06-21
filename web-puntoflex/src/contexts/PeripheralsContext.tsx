import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PeripheralKind =
  | "barcodeScanner"
  | "printer"
  | "cashDrawer"
  | "cardTerminal";

export interface PeripheralInfo {
  kind: PeripheralKind;
  label: string;
  detected: boolean;
  name: string | null;
  type: string | null;
  interface: "usb" | "bluetooth" | "keyboard-wedge" | "inferred" | "camera" | null;
}

export interface PeripheralsState {
  /** All 4 peripherals with their detection status */
  peripherals: PeripheralInfo[];
  /** Convenience getters */
  barcodeScanner: PeripheralInfo;
  printer: PeripheralInfo;
  cashDrawer: PeripheralInfo;
  cardTerminal: PeripheralInfo;
  /** Whether we've done an initial scan */
  scanned: boolean;
  /** Rescan all interfaces */
  rescan: () => void;
  /** Barcode detected callback (keyboard wedge) — set by consumers */
  onBarcode: ((barcode: string) => void) | null;
  setOnBarcode: (fn: ((barcode: string) => void) | null) => void;
  /** Camera barcode detector availability */
  cameraBarcodeSupported: boolean;
  /** Open camera scanner UI */
  openCameraScanner: () => void;
  cameraScanning: boolean;
  setCameraScanning: (v: boolean) => void;
  /** Print via Web USB / Bluetooth */
  printReceipt: (markup: string) => Promise<boolean>;
}

// ─── Known hardware vendors ──────────────────────────────────────────────────

/** Vendor IDs mapped to device types */
const USB_VENDORS: Record<number, { name: string; kinds: PeripheralKind[] }> = {
  // Printers
  0x04b8: { name: "Epson", kinds: ["printer", "cashDrawer"] },
  0x0519: { name: "Star Micronics", kinds: ["printer", "cashDrawer"] },
  0x0a5f: { name: "Zebra Technologies", kinds: ["printer", "cashDrawer"] },
  0x1504: { name: "Bixolon", kinds: ["printer", "cashDrawer"] },
  0x1343: { name: "Citizen", kinds: ["printer", "cashDrawer"] },
  0x067b: { name: "Prolific (printer adapter)", kinds: ["printer"] },
  0x0416: { name: "Winbond (receipt printer)", kinds: ["printer", "cashDrawer"] },
  0x0493: { name: "Citizen / Epson", kinds: ["printer", "cashDrawer"] },
  0x0471: { name: "Philips (POS printer)", kinds: ["printer"] },

  // Barcode Scanners
  0x0c2e: { name: "Honeywell", kinds: ["barcodeScanner"] },
  0x05e0: { name: "Symbol / Zebra", kinds: ["barcodeScanner"] },
  0x05f9: { name: "Datalogic", kinds: ["barcodeScanner"] },
  0x0766: { name: "Denso", kinds: ["barcodeScanner"] },
  0x1eab: { name: "Newland", kinds: ["barcodeScanner"] },
  0x06d3: { name: "Foxlink / CipherLab", kinds: ["barcodeScanner"] },
  0x080c: { name: "Code Corporation", kinds: ["barcodeScanner"] },
  0x2dd6: { name: "Socket Mobile", kinds: ["barcodeScanner"] },

  // Card Terminals
  0x11ca: { name: "Verifone", kinds: ["cardTerminal"] },
  0x0b00: { name: "Ingenico", kinds: ["cardTerminal"] },
  0x28e9: { name: "PAX Technology", kinds: ["cardTerminal"] },
  0x2b06: { name: "Newland Payment", kinds: ["cardTerminal"] },
  0x1fd2: { name: "MagTek", kinds: ["cardTerminal"] },
  0x0801: { name: "MagTek", kinds: ["cardTerminal"] },
};

/** Barcode-scanner-like typing: keystrokes faster than this are "scanner" */
const SCANNER_TYPING_THRESHOLD_MS = 80;
const SCANNER_BUFFER_MAX_MS = 200;

// ─── Context ─────────────────────────────────────────────────────────────────

interface PeripheralsContextValue extends PeripheralsState {}

const PeripheralsContext = createContext<PeripheralsContextValue | null>(null);

function makeDefault(kind: PeripheralKind, label: string): PeripheralInfo {
  return { kind, label, detected: false, name: null, type: null, interface: null };
}

export function PeripheralsProvider({ children }: { children: React.ReactNode }) {
  const [peripherals, setPeripherals] = useState<PeripheralInfo[]>([
    makeDefault("barcodeScanner", "Lector Código Barras"),
    makeDefault("printer", "Impresora de Tickets"),
    makeDefault("cashDrawer", "Cajón de Dinero"),
    makeDefault("cardTerminal", "Terminal de Cobro"),
  ]);
  const [scanned, setScanned] = useState(false);
  const [cameraBarcodeSupported, setCameraBarcodeSupported] = useState(false);
  const [cameraScanning, setCameraScanning] = useState(false);
  const onBarcodeRef = useRef<((barcode: string) => void) | null>(null);

  // ── USB Detection ───────────────────────────────────────────────────────

  const detectUSB = useCallback(async () => {
    const usb = (navigator as any).usb;
    if (!usb?.getDevices) return;

    try {
      const devices: USBDevice[] = await usb.getDevices();
      const updates: Record<PeripheralKind, PeripheralInfo | null> = {
        barcodeScanner: null,
        printer: null,
        cashDrawer: null,
        cardTerminal: null,
      };

      for (const dev of devices) {
        const vendor = USB_VENDORS[dev.vendorId];
        if (!vendor) continue;

        for (const kind of vendor.kinds) {
          if (!updates[kind]) {
            updates[kind] = {
              kind,
              label: getLabel(kind),
              detected: true,
              name: vendor.name,
              type: `${dev.productName ?? "Dispositivo"} (USB)`,
              interface: "usb",
            };
          }
        }
      }

      setPeripherals((prev) =>
        prev.map((p) => updates[p.kind] ?? p)
      );
    } catch {
      // Web USB not available — silently skip
    }
  }, []);

  // ── Bluetooth Detection ─────────────────────────────────────────────────

  const detectBluetooth = useCallback(async () => {
    const bt = (navigator as any).bluetooth;
    if (!bt?.getAvailability) return;

    try {
      const available = await bt.getAvailability();
      if (!available) return;

      // Request a scan — browsers only expose device scanning through
      // requestDevice() which requires a user gesture. We start passive
      // and show a "Scan" button for active scanning.
      // For now, enumerate previously-paired devices via getDevices()
      if (bt.getDevices) {
        const devices: BluetoothDevice[] = await bt.getDevices();
        const updates: Record<PeripheralKind, PeripheralInfo | null> = {
          barcodeScanner: null,
          printer: null,
          cashDrawer: null,
          cardTerminal: null,
        };

        for (const dev of devices) {
          const name = dev.name?.toLowerCase() ?? "";
          if (name.includes("impresor") || name.includes("printer") || name.includes("epson") || name.includes("star") || name.includes("zebra") || name.includes("bixolon") || name.includes("tm-") || name.includes("tmt")) {
            if (!updates.printer) {
              updates.printer = { kind: "printer", label: "Impresora de Tickets", detected: true, name: dev.name ?? "Impresora BT", type: "Bluetooth", interface: "bluetooth" };
              updates.cashDrawer = { kind: "cashDrawer", label: "Cajón de Dinero", detected: true, name: "Vinculado a impresora", type: "Vía impresora BT", interface: "inferred" };
            }
          }
          if (name.includes("scanner") || name.includes("lector") || name.includes("barcode") || name.includes("escáner") || name.includes("honeywell") || name.includes("symbol") || name.includes("datalogic")) {
            if (!updates.barcodeScanner) {
              updates.barcodeScanner = { kind: "barcodeScanner", label: "Lector Código Barras", detected: true, name: dev.name ?? "Lector BT", type: "Bluetooth", interface: "bluetooth" };
            }
          }
          if (name.includes("terminal") || name.includes("verifone") || name.includes("ingenico") || name.includes("pos") || name.includes("pax") || name.includes("pago")) {
            if (!updates.cardTerminal) {
              updates.cardTerminal = { kind: "cardTerminal", label: "Terminal de Cobro", detected: true, name: dev.name ?? "Terminal BT", type: "Bluetooth", interface: "bluetooth" };
            }
          }
        }

        setPeripherals((prev) =>
          prev.map((p) => updates[p.kind] ?? p)
        );
      }
    } catch {
      // Bluetooth not available
    }
  }, []);

  // ── Keyboard Wedge Detection ────────────────────────────────────────────

  useEffect(() => {
    let buffer = "";
    let lastKeyTime = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only detect on focused inputs (not on Ctrl/Cmd shortcuts)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Ignore function keys, arrows, etc.
      if (e.key.length !== 1 && e.key !== "Enter") return;
      // Ignore if event comes from a textarea or editable div
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA") return;

      const now = Date.now();
      const gap = now - lastKeyTime;

      if (e.key === "Enter") {
        if (buffer.length >= 3 && gap < SCANNER_BUFFER_MAX_MS) {
          // Likely barcode scanner input
          const barcode = buffer.trim();
          buffer = "";
          lastKeyTime = 0;

          // Mark barcode scanner as detected
          setPeripherals((prev) =>
            prev.map((p) =>
              p.kind === "barcodeScanner" && !p.detected
                ? { ...p, detected: true, name: "Lector detectado", type: "Teclado wedge", interface: "keyboard-wedge" }
                : p
            )
          );

          // Fire callback
          onBarcodeRef.current?.(barcode);
          return;
        }
        buffer = "";
        lastKeyTime = 0;
        return;
      }

      // If gap is too large, reset buffer (human typing)
      if (gap > SCANNER_BUFFER_MAX_MS && buffer.length > 0) {
        buffer = "";
      }

      buffer += e.key;
      lastKeyTime = now;

      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        buffer = "";
        lastKeyTime = 0;
      }, SCANNER_BUFFER_MAX_MS);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // ── Camera Barcode Detection ────────────────────────────────────────────

  useEffect(() => {
    if ("BarcodeDetector" in window) {
      setCameraBarcodeSupported(true);
    }
  }, []);

  // ── Scan orchestrator ───────────────────────────────────────────────────

  const rescan = useCallback(async () => {
    await Promise.allSettled([detectUSB(), detectBluetooth()]);
    setScanned(true);
  }, [detectUSB, detectBluetooth]);

  // Auto-scan on mount
  useEffect(() => {
    rescan();
  }, [rescan]);

  // ── Print via Web USB ───────────────────────────────────────────────────

  const printReceipt = useCallback(async (_markup: string): Promise<boolean> => {
    // Web USB printing requires a specific printer to be selected first.
    // For now, we rely on window.print() in ThermalReceipt.
    // This is a placeholder for future direct ESC/POS printing.
    return false;
  }, []);

  // ── Camera scanner opener ──────────────────────────────────────────────

  const openCameraScanner = useCallback(() => {
    setCameraScanning(true);
  }, []);

  // ── Convenience getters ─────────────────────────────────────────────────

  const barcodeScanner =
    peripherals.find((p) => p.kind === "barcodeScanner") ??
    makeDefault("barcodeScanner", "Lector Código Barras");
  const printer =
    peripherals.find((p) => p.kind === "printer") ??
    makeDefault("printer", "Impresora de Tickets");
  const cashDrawer =
    peripherals.find((p) => p.kind === "cashDrawer") ??
    makeDefault("cashDrawer", "Cajón de Dinero");
  const cardTerminal =
    peripherals.find((p) => p.kind === "cardTerminal") ??
    makeDefault("cardTerminal", "Terminal de Cobro");

  const setOnBarcode = useCallback((fn: ((barcode: string) => void) | null) => {
    onBarcodeRef.current = fn;
  }, []);

  const value: PeripheralsContextValue = {
    peripherals,
    barcodeScanner,
    printer,
    cashDrawer,
    cardTerminal,
    scanned,
    rescan,
    onBarcode: onBarcodeRef.current,
    setOnBarcode,
    cameraBarcodeSupported,
    openCameraScanner,
    cameraScanning,
    setCameraScanning,
    printReceipt,
  };

  return (
    <PeripheralsContext.Provider value={value}>
      {children}
    </PeripheralsContext.Provider>
  );
}

export function usePeripherals(): PeripheralsContextValue {
  const ctx = useContext(PeripheralsContext);
  if (!ctx) {
    throw new Error("usePeripherals must be used within PeripheralsProvider");
  }
  return ctx;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLabel(kind: PeripheralKind): string {
  switch (kind) {
    case "barcodeScanner": return "Lector Código Barras";
    case "printer": return "Impresora de Tickets";
    case "cashDrawer": return "Cajón de Dinero";
    case "cardTerminal": return "Terminal de Cobro";
  }
}
