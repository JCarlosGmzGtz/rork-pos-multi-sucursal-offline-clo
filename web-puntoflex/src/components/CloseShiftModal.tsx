import { useState } from "react";
import {
  Banknote,
  ArrowDownToLine,
  Calculator,
  TrendingUp,
  TrendingDown,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

interface CloseShiftModalProps {
  open: boolean;
  initialCash: number;
  shiftSalesTotal: number;
  onCloseShift: (declaredCash: number) => Promise<void>;
}

export default function CloseShiftModal({
  open,
  initialCash,
  shiftSalesTotal,
  onCloseShift,
}: CloseShiftModalProps) {
  const [declaredCash, setDeclaredCash] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const declared = Number(declaredCash);
  const expectedCash = initialCash + shiftSalesTotal;
  const hasValue = declaredCash.trim() && !isNaN(declared);
  const difference = hasValue
    ? Math.round((declared - expectedCash) * 100) / 100
    : 0;

  const handleClose = async () => {
    if (!hasValue || declared < 0) {
      toast.error("Ingresa el efectivo declarado");
      return;
    }
    setSubmitting(true);
    try {
      await onCloseShift(declared);
      toast.success("Turno cerrado correctamente");
    } catch {
      toast.error("Error al cerrar el turno");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} modal>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
            <ArrowDownToLine className="h-7 w-7 text-slate-600" />
          </div>
          <DialogTitle className="text-center text-xl">Cerrar Caja</DialogTitle>
          <DialogDescription className="text-center">
            Declara el efectivo físico que tienes en el cajón para calcular el
            corte.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-xl bg-slate-50 p-4 space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Fondo inicial</span>
              <span className="font-medium tabular-nums">
                {formatCurrency(initialCash)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Ventas del turno</span>
              <span className="font-medium tabular-nums">
                {formatCurrency(shiftSalesTotal)}
              </span>
            </div>
            <Separator />
            <div className="flex justify-between text-base font-bold">
              <span className="text-slate-700">Total esperado</span>
              <span className="tabular-nums">{formatCurrency(expectedCash)}</span>
            </div>
          </div>

          {/* Declared cash input */}
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 flex items-center gap-1.5">
              <Calculator className="h-4 w-4 text-slate-500" />
              Efectivo en cajón
            </p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-slate-400">
                $
              </span>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={declaredCash}
                onChange={(e) => setDeclaredCash(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleClose()}
                className="border-slate-200 pl-8 text-lg font-semibold"
                autoFocus
              />
            </div>
          </div>

          {/* Difference display */}
          {hasValue && (
            <div
              className={`rounded-xl p-4 text-center ${
                difference === 0
                  ? "bg-emerald-50"
                  : difference > 0
                    ? "bg-emerald-50"
                    : "bg-red-50"
              }`}
            >
              {difference === 0 ? (
                <div className="flex items-center justify-center gap-2 text-emerald-700">
                  <CircleCheck className="h-5 w-5" />
                  <span className="font-semibold">Cuadre perfecto — sin diferencia</span>
                </div>
              ) : difference > 0 ? (
                <div>
                  <div className="flex items-center justify-center gap-2 text-emerald-700">
                    <TrendingUp className="h-5 w-5" />
                    <span className="font-semibold">Sobrante</span>
                  </div>
                  <p className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">
                    +{formatCurrency(difference)}
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-center gap-2 text-red-600">
                    <TrendingDown className="h-5 w-5" />
                    <span className="font-semibold">Faltante</span>
                  </div>
                  <p className="mt-1 text-2xl font-bold text-red-600 tabular-nums">
                    {formatCurrency(difference)}
                  </p>
                </div>
              )}
              <p className="mt-1 text-xs opacity-70">
                Efectivo declarado: {formatCurrency(declared)} · Esperado:{" "}
                {formatCurrency(expectedCash)}
              </p>
            </div>
          )}

          <div className="rounded-lg bg-amber-50 p-3 flex items-start gap-2">
            <CircleAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700">
              Al cerrar el turno ya no podrás registrar más ventas. Deberás abrir
              un nuevo turno para continuar.
            </p>
          </div>

          <div className="flex gap-3">
            <Button
              className="flex-1 bg-slate-800 py-5 text-base font-bold text-white hover:bg-slate-900"
              onClick={handleClose}
              disabled={submitting || !hasValue}
            >
              {submitting ? "Cerrando..." : "Cerrar Turno"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
