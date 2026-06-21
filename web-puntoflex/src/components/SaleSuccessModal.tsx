import { useState, useCallback } from "react";
import {
  Printer,
  Mail,
  CheckCircle2,
  Copy,
  Building2,
  Banknote,
  CreditCard,
  ArrowRightLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Sale, Branch } from "@/db/database";
import ThermalReceipt, { buildEmailHtml } from "@/components/ThermalReceipt";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

const paymentLabels: Record<string, { label: string; icon: typeof Banknote }> = {
  cash: { label: "Efectivo", icon: Banknote },
  card: { label: "Tarjeta", icon: CreditCard },
  transfer: { label: "Transferencia", icon: ArrowRightLeft },
};

interface SaleSuccessModalProps {
  open: boolean;
  onClose: (didPrintOrSend: boolean) => void;
  sale: Sale;
  branch: Branch;
  branchUserName: string;
  businessEmail: string;
  receiptWidthMm: 58 | 80;
}

export default function SaleSuccessModal({
  open,
  onClose,
  sale,
  branch,
  branchUserName,
  businessEmail,
  receiptWidthMm,
}: SaleSuccessModalProps) {
  const [customerEmail, setCustomerEmail] = useState(sale.customerEmail || "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const payInfo = paymentLabels[sale.paymentMethod] ?? paymentLabels.cash;

  const handlePrint = useCallback(() => {
    // Store a flag so POS knows to clear cart after printing
    onClose(true);
    // Delay slightly so the modal closes before print dialog opens
    setTimeout(() => {
      window.print();
    }, 150);
  }, [onClose]);

  const handleSendEmail = useCallback(async () => {
    if (!customerEmail.trim() || !customerEmail.includes("@")) {
      toast.error("Ingresa un correo electrónico válido");
      return;
    }

    const htmlBody = buildEmailHtml(sale, branch, branchUserName, businessEmail);

    // Update the sale with customer email
    try {
      const { db } = await import("@/db/database");
      await db.sales.update(sale.id, { customerEmail: customerEmail.trim() } as Partial<Sale>);
    } catch {
      // Non-critical — continue
    }

    setSending(true);

    // Copy email HTML to clipboard for now (backend send can be added later)
    try {
      await navigator.clipboard.writeText(htmlBody);
      setSent(true);
      toast.success("Plantilla de correo copiada al portapapeles", {
        description: "Pégala en tu cliente de correo para enviarla al cliente.",
      });
      // Clear cart after sending
      setTimeout(() => onClose(true), 800);
    } catch {
      toast.error("No se pudo copiar al portapapeles");
      setSending(false);
    }
  }, [customerEmail, sale, branch, branchUserName, businessEmail, onClose]);

  const handleClose = useCallback(() => {
    onClose(sent);
  }, [onClose, sent]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            Venta registrada
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Sale summary card */}
          <div className="rounded-xl bg-slate-50 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Building2 className="h-4 w-4" />
              <span>{branch.name}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-slate-500">Folio</span>
                <p className="font-mono font-medium text-slate-900 text-xs">
                  {sale.id.slice(0, 12)}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Fecha</span>
                <p className="font-medium text-slate-900 text-xs">
                  {formatDate(sale.createdAt)}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Cajero</span>
                <p className="font-medium text-slate-900 text-xs">
                  {branchUserName}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Artículos</span>
                <p className="font-medium text-slate-900 text-xs">
                  {sale.items.reduce((s, i) => s + i.quantity, 0)}
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <payInfo.icon className="h-4 w-4" />
                <span>{payInfo.label}</span>
              </div>
              <span className="text-2xl font-bold text-slate-900 tabular-nums">
                {formatCurrency(sale.total)}
              </span>
            </div>

            {sale.paymentMethod === "cash" && (
              <div className="grid grid-cols-2 gap-x-4 text-xs text-slate-500">
                <span>Recibido: {formatCurrency(sale.amountPaid)}</span>
                <span>Cambio: {formatCurrency(sale.change)}</span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 border-slate-200 text-slate-700 hover:bg-slate-50 gap-2"
              onClick={handlePrint}
            >
              <Printer className="h-4 w-4" />
              Imprimir Ticket
            </Button>
            <Button
              variant="outline"
              className="flex-1 border-slate-200 text-slate-700 hover:bg-slate-50 gap-2"
              onClick={() => {
                const htmlBody = buildEmailHtml(sale, branch, branchUserName, businessEmail);
                navigator.clipboard.writeText(htmlBody).then(() => {
                  toast.success("HTML del correo copiado");
                });
              }}
            >
              <Copy className="h-4 w-4" />
              Copiar HTML
            </Button>
          </div>

          <Separator />

          {/* Email field */}
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 flex items-center gap-1.5">
              <Mail className="h-4 w-4" />
              Enviar por correo
            </p>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="correo@cliente.com"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="border-slate-200 flex-1"
                disabled={sent}
              />
              <Button
                className="bg-amber-500 text-white hover:bg-amber-600 gap-2"
                onClick={handleSendEmail}
                disabled={sending || sent || !customerEmail.trim()}
              >
                {sending ? "Enviando..." : sent ? "Copiado" : "Enviar"}
                <Mail className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {sent && (
            <p className="text-xs text-emerald-600 bg-emerald-50 rounded-lg p-2 text-center">
              Pega el contenido en tu cliente de correo (Gmail, Outlook, etc.) para enviarlo al cliente.
            </p>
          )}

          {/* Hidden ThermalReceipt for printing */}
          <div className="hidden">
            <ThermalReceipt
              sale={sale}
              branch={branch}
              branchUserName={branchUserName}
              businessEmail={businessEmail}
              widthMm={receiptWidthMm}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
