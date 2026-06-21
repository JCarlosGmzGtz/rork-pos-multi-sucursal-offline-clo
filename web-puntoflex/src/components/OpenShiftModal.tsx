import { useState } from "react";
import { Banknote, Clock, Building2 } from "lucide-react";
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

interface OpenShiftModalProps {
  open: boolean;
  branchName: string;
  onOpenShift: (initialCash: number) => Promise<void>;
}

export default function OpenShiftModal({
  open,
  branchName,
  onOpenShift,
}: OpenShiftModalProps) {
  const [initialCash, setInitialCash] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const amount = Number(initialCash);
    if (!initialCash.trim() || isNaN(amount) || amount < 0) {
      toast.error("Ingresa un fondo inicial válido");
      return;
    }
    setSubmitting(true);
    try {
      await onOpenShift(amount);
      toast.success("Caja abierta correctamente");
      setSubmitting(false);
    } catch {
      toast.error("Error al abrir la caja");
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
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
            <Banknote className="h-7 w-7 text-amber-600" />
          </div>
          <DialogTitle className="text-center text-xl">Abrir Caja</DialogTitle>
          <DialogDescription className="text-center">
            Debes abrir un turno de caja antes de poder realizar ventas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <Building2 className="h-4 w-4 text-slate-500" />
            <span className="text-sm text-slate-600">{branchName}</span>
          </div>

          <Separator />

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              Fondo inicial en efectivo
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
                value={initialCash}
                onChange={(e) => setInitialCash(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                className="border-slate-200 pl-8 text-lg font-semibold"
                autoFocus
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Es el efectivo con el que inicias el turno (cambio, fondo de caja).
            </p>
          </div>

          <div className="rounded-lg bg-amber-50 p-3 flex items-start gap-2">
            <Clock className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700">
              El turno quedará registrado con la fecha y hora actual. Podrás cerrarlo
              al finalizar tu jornada.
            </p>
          </div>

          <Button
            className="w-full bg-amber-500 py-6 text-base font-bold text-white hover:bg-amber-600"
            onClick={handleSubmit}
            disabled={submitting || !initialCash.trim()}
          >
            {submitting ? "Abriendo caja..." : "Abrir Turno"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
