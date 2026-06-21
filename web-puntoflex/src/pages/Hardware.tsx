import { usePeripherals, type PeripheralInfo } from "@/contexts/PeripheralsContext";
import {
  ScanLine,
  Printer,
  CreditCard,
  Wallet,
  Usb,
  Bluetooth,
  Keyboard,
  Camera,
  ArrowRightLeft,
  Circle,
  RefreshCw,
  Search,
  QrCode,
  Barcode,
  MonitorSmartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ─── Constants ───────────────────────────────────────────────────────────────

const LABEL_MAP: Record<string, string> = {
  barcodeScanner: "Lector de Código de Barras / QR",
  printer: "Impresora de Tickets",
  cashDrawer: "Cajón de Dinero",
  cardTerminal: "Terminal de Cobro con Tarjeta",
};

const DESC_MAP: Record<string, string> = {
  barcodeScanner:
    "Escanea códigos de barras y QR de productos para agilizar la búsqueda en el POS.",
  printer:
    "Impresora térmica para tickets de compra. Detectada por USB o Bluetooth.",
  cashDrawer:
    "Cajón de dinero físico. Normalmente conectado a la impresora y se abre automáticamente al imprimir un ticket.",
  cardTerminal:
    "Terminal para cobros con tarjeta de crédito/débito. Puede conectarse por USB o Bluetooth.",
};

// ─── Barcode Camera Scanner ────────────────────────────────────────────────

function BarcodeCameraScanner({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scanning, setScanning] = useState(true);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let detector: any = null;

    async function start() {
      try {
        // Init BarcodeDetector
        if ("BarcodeDetector" in window) {
          detector = new (window as any).BarcodeDetector({
            formats: [
              "ean_8", "ean_13", "upc_a", "upc_e",
              "code_128", "code_39", "code_93",
              "qr_code", "data_matrix", "pdf417",
            ],
          });
        } else {
          setError("BarcodeDetector no disponible en este navegador.");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }

        // Scan loop
        intervalRef.current = setInterval(async () => {
          if (!detector || !videoRef.current || !canvasRef.current) return;

          const video = videoRef.current;
          if (video.readyState < 2) return;

          const canvas = canvasRef.current;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          try {
            const barcodes = await detector.detect(canvas);
            if (barcodes.length > 0) {
              const value = barcodes[0].rawValue;
              setLastResult(value);
              setScanning(false);
              // Stop stream
              if (intervalRef.current) clearInterval(intervalRef.current);
              stream.getTracks().forEach((t) => t.stop());
            }
          } catch {
            // Detection error — keep trying
          }
        }, 300);
      } catch (err: any) {
        setError(err?.message ?? "No se pudo acceder a la cámara.");
      }
    }

    start();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Video preview */}
      <div className="relative overflow-hidden rounded-xl bg-slate-900 aspect-video">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="hidden" />

        {scanning && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-40 rounded-lg border-2 border-amber-400/60 shadow-[0_0_20px_rgba(251,191,36,0.15)]" />
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/80 px-4 py-1.5 text-xs text-slate-300">
              Escaneando...
            </div>
          </div>
        )}

        {lastResult && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/80">
            <div className="rounded-full bg-emerald-500/20 p-3">
              <Barcode className="h-8 w-8 text-emerald-400" />
            </div>
            <p className="text-sm text-white">Código detectado</p>
            <code className="rounded-md bg-slate-800 px-4 py-2 font-mono text-sm text-amber-400">
              {lastResult}
            </code>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/90 px-6 text-center">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {lastResult && (
          <Button
            onClick={() => {
              navigator.clipboard.writeText(lastResult);
              toast.success("Código copiado al portapapeles");
            }}
            variant="outline"
            size="sm"
            className="flex-1"
          >
            Copiar código
          </Button>
        )}
        <Button
          onClick={onClose}
          variant="ghost"
          size="sm"
          className={lastResult ? "" : "flex-1"}
        >
          Cerrar escáner
        </Button>
      </div>
    </div>
  );
}

// ─── Peripheral Card ───────────────────────────────────────────────────────

function PeripheralCard({ info }: { info: PeripheralInfo }) {
  const { rescan } = usePeripherals();

  return (
    <Card
      className={cn(
        "border-slate-200 p-5 transition-all",
        info.detected && "border-emerald-200 bg-emerald-50/40 shadow-sm"
      )}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
            info.detected
              ? "bg-emerald-100 text-emerald-600"
              : "bg-slate-100 text-slate-400"
          )}
        >
          {info.kind === "barcodeScanner" && <ScanLine className="h-6 w-6" />}
          {info.kind === "printer" && <Printer className="h-6 w-6" />}
          {info.kind === "cashDrawer" && <Wallet className="h-6 w-6" />}
          {info.kind === "cardTerminal" && <CreditCard className="h-6 w-6" />}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-900">
                {LABEL_MAP[info.kind] ?? info.label}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {DESC_MAP[info.kind] ?? ""}
              </p>
            </div>
            {/* Status badge */}
            <Badge
              className={cn(
                "shrink-0 gap-1 px-2 py-0.5 text-[11px] font-medium",
                info.detected
                  ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                  : "border-slate-200 bg-slate-100 text-slate-500"
              )}
              variant="outline"
            >
              <Circle
                className={cn(
                  "h-1.5 w-1.5",
                  info.detected
                    ? "fill-emerald-500 text-emerald-500"
                    : "text-slate-400"
                )}
              />
              {info.detected ? "Conectado" : "No detectado"}
            </Badge>
          </div>

          {/* Details when detected */}
          {info.detected && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {info.name && (
                <span className="font-medium text-slate-700">{info.name}</span>
              )}
              {info.type && (
                <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px]">
                  {info.type}
                </span>
              )}
              {info.interface && (
                <span className="flex items-center gap-1 text-[10px]">
                  {info.interface === "usb" && <Usb className="h-3 w-3" />}
                  {info.interface === "bluetooth" && <Bluetooth className="h-3 w-3" />}
                  {info.interface === "keyboard-wedge" && <Keyboard className="h-3 w-3" />}
                  {info.interface === "camera" && <Camera className="h-3 w-3" />}
                  {info.interface === "inferred" && <ArrowRightLeft className="h-3 w-3" />}
                  {info.interface === "usb" && "USB"}
                  {info.interface === "bluetooth" && "Bluetooth"}
                  {info.interface === "keyboard-wedge" && "Teclado"}
                  {info.interface === "camera" && "Cámara"}
                  {info.interface === "inferred" && "Vinculado"}
                </span>
              )}
            </div>
          )}

          {/* Action buttons when not detected */}
          {!info.detected && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={rescan}
              >
                <RefreshCw className="mr-1.5 h-3 w-3" />
                Re-escanear
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── USB Request Helper ─────────────────────────────────────────────────────

async function requestUSBDevice(filters: USBDeviceFilter[]) {
  const usb = (navigator as any).usb;
  if (!usb) {
    toast.error("Web USB no disponible en este navegador.");
    return null;
  }
  try {
    const device = await usb.requestDevice({ filters });
    return device;
  } catch (err: any) {
    if (err?.name !== "NotFoundError") {
      toast.error("Error al buscar dispositivo USB.");
    }
    return null;
  }
}

async function requestBTDevice(filters: BluetoothLEScanFilter[]) {
  const bt = (navigator as any).bluetooth;
  if (!bt) {
    toast.error("Web Bluetooth no disponible en este navegador.");
    return null;
  }
  try {
    const device = await bt.requestDevice({
      filters,
      acceptAllDevices: filters.length === 0,
    });
    return device;
  } catch (err: any) {
    if (err?.name !== "NotFoundError") {
      toast.error("Error al buscar dispositivo Bluetooth.");
    }
    return null;
  }
}

// ─── Main Hardware Page ────────────────────────────────────────────────────

export default function Hardware() {
  const {
    peripherals,
    scanned,
    rescan,
    cameraBarcodeSupported,
    cameraScanning,
    setCameraScanning,
    openCameraScanner,
    setOnBarcode,
  } = usePeripherals();

  const [pairingUSB, setPairingUSB] = useState(false);
  const [pairingBT, setPairingBT] = useState(false);

  // Set up barcode callback for this page
  useEffect(() => {
    setOnBarcode((barcode: string) => {
      toast.success(`Código escaneado: ${barcode}`);
    });
    return () => setOnBarcode(null);
  }, [setOnBarcode]);

  const handlePairUSB = async () => {
    setPairingUSB(true);
    try {
      // Try common POS device filters
      await requestUSBDevice([
        // Epson printers
        { vendorId: 0x04b8 },
        // Star Micronics
        { vendorId: 0x0519 },
        // Zebra
        { vendorId: 0x0a5f },
        // Honeywell scanners
        { vendorId: 0x0c2e },
        // Datalogic
        { vendorId: 0x05f9 },
        // Verifone terminals
        { vendorId: 0x11ca },
        // Symbol scanners
        { vendorId: 0x05e0 },
      ]);
      await rescan();
    } finally {
      setPairingUSB(false);
    }
  };

  const handlePairBT = async () => {
    setPairingBT(true);
    try {
      await requestBTDevice([]);
      await rescan();
    } finally {
      setPairingBT(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Hardware</h2>
            <p className="text-sm text-slate-500">
              Dispositivos detectados automáticamente
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePairUSB}
              disabled={pairingUSB}
              className="gap-1.5"
            >
              <Usb className="h-4 w-4" />
              {pairingUSB ? "Buscando..." : "Vincular USB"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePairBT}
              disabled={pairingBT}
              className="gap-1.5"
            >
              <Bluetooth className="h-4 w-4" />
              {pairingBT ? "Buscando..." : "Vincular Bluetooth"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={rescan}
              className="gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              Re-escanear
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-8">
          {/* Camera Scanner Section */}
          {cameraBarcodeSupported && (
            <Card className="border-slate-200 p-5">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                  <Camera className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Escáner por Cámara</p>
                  <p className="text-xs text-slate-500">
                    Usa la cámara de tu dispositivo para escanear códigos de barras y QR
                  </p>
                </div>
              </div>
              {cameraScanning ? (
                <BarcodeCameraScanner onClose={() => setCameraScanning(false)} />
              ) : (
                <Button
                  onClick={openCameraScanner}
                  className="gap-2 bg-amber-500 hover:bg-amber-600"
                >
                  <QrCode className="h-4 w-4" />
                  Abrir Escáner por Cámara
                </Button>
              )}
            </Card>
          )}

          {/* Peripherals Grid */}
          <div className="space-y-4">
            {peripherals.map((p) => (
              <PeripheralCard key={p.kind} info={p} />
            ))}
          </div>

          {/* Keyboard Wedge Info */}
          <Card className="border-slate-200 bg-amber-50/50 p-5">
            <div className="flex items-start gap-3">
              <Keyboard className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold text-slate-900">
                  Lector por teclado (wedge)
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  La mayoría de los lectores de códigos de barras se conectan por USB y
                  funcionan como un teclado. PuntoFlex detecta automáticamente cuando
                  se escanea un código por la velocidad de escritura.
                  Solo acerca un código de barras al lector mientras estás en cualquier
                  pantalla — el código se capturará automáticamente.
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <MonitorSmartphone className="h-3.5 w-3.5" />
                  <span>
                    También puedes usar el escáner por cámara si tu dispositivo tiene una.
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Scan status */}
          {scanned && (
            <p className="text-center text-xs text-slate-400">
              Escaneo completado.{" "}
              {peripherals.filter((p) => p.detected).length === 0
                ? "No se detectaron dispositivos. Conecta un periférico y vuelve a escanear."
                : "Los dispositivos se actualizan automáticamente al conectarlos."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
