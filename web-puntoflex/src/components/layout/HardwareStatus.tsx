import { usePeripherals, type PeripheralInfo } from "@/contexts/PeripheralsContext";
import {
  ScanLine,
  Printer,
  CreditCard,
  Wallet,
  Circle,
  Usb,
  Bluetooth,
  Keyboard,
  Camera,
  ArrowRightLeft,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

// ─── Peripheral icon map ─────────────────────────────────────────────────────

const ICON_MAP: Record<string, ReactNode> = {
  barcodeScanner: <ScanLine className="h-4 w-4" />,
  printer: <Printer className="h-4 w-4" />,
  cashDrawer: <Wallet className="h-4 w-4" />,
  cardTerminal: <CreditCard className="h-4 w-4" />,
};

function interfaceIcon(iface: PeripheralInfo["interface"]): ReactNode {
  switch (iface) {
    case "usb":       return <Usb className="h-2.5 w-2.5" />;
    case "bluetooth":  return <Bluetooth className="h-2.5 w-2.5" />;
    case "keyboard-wedge": return <Keyboard className="h-2.5 w-2.5" />;
    case "camera":    return <Camera className="h-2.5 w-2.5" />;
    case "inferred":  return <ArrowRightLeft className="h-2.5 w-2.5" />;
    default:          return null;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function HardwareStatus() {
  const {
    peripherals,
    scanned,
    rescan,
    cameraBarcodeSupported,
    cameraScanning,
  } = usePeripherals();

  const detectedCount = peripherals.filter((p) => p.detected).length;

  return (
    <div className="space-y-2 rounded-lg bg-slate-800/50 p-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Periféricos
        </p>
        <button
          onClick={rescan}
          className="rounded px-1.5 py-0.5 text-[9px] text-slate-500 hover:bg-slate-700 hover:text-amber-400 transition-colors"
        >
          {scanned ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5" />
              Re-escanear
            </span>
          ) : (
            "Escanear"
          )}
        </button>
      </div>

      {/* Peripheral list */}
      <div className="space-y-1.5">
        {peripherals.map((p) => (
          <div
            key={p.kind}
            className={cn(
              "flex items-center gap-2 rounded px-1.5 py-1 transition-colors",
              p.detected
                ? "text-slate-200"
                : "text-slate-600"
            )}
          >
            {/* Icon */}
            <span
              className={cn(
                "shrink-0",
                p.detected ? "text-amber-400" : "text-slate-600"
              )}
            >
              {ICON_MAP[p.kind] ?? <Circle className="h-4 w-4" />}
            </span>

            {/* Label */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-medium">{p.label}</p>
              {p.detected && p.name && (
                <p className="truncate text-[8px] text-slate-500">{p.name}</p>
              )}
            </div>

            {/* Status dot */}
            <span className="flex shrink-0 items-center gap-1">
              {p.detected ? (
                <>
                  <Circle className="h-2 w-2 fill-emerald-400 text-emerald-400" />
                  {p.interface && (
                    <span className="text-slate-500">{interfaceIcon(p.interface)}</span>
                  )}
                </>
              ) : (
                <Circle className="h-2 w-2 text-slate-700" />
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Footer summary */}
      {scanned && (
        <p className="text-[9px] text-slate-600">
          {detectedCount > 0
            ? `${detectedCount} dispositivo${detectedCount !== 1 ? "s" : ""} detectado${detectedCount !== 1 ? "s" : ""}`
            : "Sin dispositivos detectados"}
          {cameraBarcodeSupported && !cameraScanning && (
            <span className="ml-1 text-amber-500/70">· Cámara disponible</span>
          )}
        </p>
      )}
    </div>
  );
}
