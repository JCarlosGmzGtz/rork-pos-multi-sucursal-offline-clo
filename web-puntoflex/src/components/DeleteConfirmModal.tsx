import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Building2,
  ShoppingCart,
  Package,
  ArrowRightLeft,
  Users,
  Clock,
  User,
  Receipt,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { generateBranchReport, generateEmployeeReport, downloadExcel, type BranchReportData, type EmployeeReportData } from "@/utils/excel";
import { useSync } from "@/contexts/SyncContext";
import { db, type Sale, type BranchUser, type Branch } from "@/db/database";
import { toast } from "sonner";

type DeleteTarget =
  | { type: "branch"; branch: Branch; sales: Sale[]; productCount: number; inventoryMovementCount: number; cashShiftCount: number; userCount: number; saleIds: string[]; branchUserIds: string[]; inventoryMovementIds: string[]; cashShiftIds: string[]; productIds: string[] }
  | { type: "employee"; employee: BranchUser; branchName: string; sales: Sale[]; cashShiftCount: number; saleIds: string[]; cashShiftIds: string[] };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: DeleteTarget | null;
  /** Called when the user confirms deletion. The caller performs the actual deletion. */
  onConfirm: () => void;
  deleting?: boolean;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

export default function DeleteConfirmModal({ open, onOpenChange, target, onConfirm, deleting }: Props) {
  const { deleteMultipleFromFirestore } = useSync();
  const [downloading, setDownloading] = useState(false);

  const summary = useMemo(() => {
    if (!target) return null;
    if (target.type === "branch") {
      const totalRevenue = target.sales.reduce((s, sale) => s + sale.total, 0);
      return {
        title: `Eliminar sucursal: ${target.branch.name}`,
        icon: Building2,
        iconColor: "text-red-500",
        stats: [
          { icon: ShoppingCart, label: "Ventas", value: `${target.sales.length} (${formatCurrency(totalRevenue)})` },
          { icon: Package, label: "Productos", value: String(target.productCount) },
          { icon: ArrowRightLeft, label: "Traspasos", value: String(target.inventoryMovementCount) },
          { icon: Users, label: "Usuarios", value: String(target.userCount) },
          { icon: Clock, label: "Turnos de caja", value: String(target.cashShiftCount) },
        ],
      };
    }
    const totalRevenue = target.sales.reduce((s, sale) => s + sale.total, 0);
    return {
      title: `Eliminar empleado: ${target.employee.name}`,
      icon: User,
      iconColor: "text-red-500",
      stats: [
        { icon: Receipt, label: "Ventas", value: `${target.sales.length} (${formatCurrency(totalRevenue)})` },
        { icon: Clock, label: "Turnos de caja", value: String(target.cashShiftCount) },
        { icon: Building2, label: "Sucursal", value: target.branchName },
      ],
    };
  }, [target]);

  const handleDownloadExcel = async () => {
    if (!target) return;
    setDownloading(true);
    try {
      if (target.type === "branch") {
        // Fetch full data for report
        const [products, inventoryMovements, cashShifts] = await Promise.all([
          db.products.where("branchId").equals(target.branch.id).toArray(),
          db.inventoryMovements
            .where("businessId").equals(target.branch.businessId)
            .toArray()
            .then((all) => all.filter((m) => m.sourceBranchId === target.branch.id || m.destBranchId === target.branch.id)),
          db.cashShifts.where("branchId").equals(target.branch.id).toArray(),
        ]);
        const reportData: BranchReportData = {
          branchName: target.branch.name,
          sales: target.sales,
          products,
          inventoryMovements,
          cashShifts,
        };
        const wb = generateBranchReport(reportData);
        downloadExcel(wb, `reporte_${target.branch.name.replace(/\s+/g, "_")}`);
      } else {
        const cashShifts = await db.cashShifts
          .where("branchUserId").equals(target.employee.id)
          .toArray();
        const reportData: EmployeeReportData = {
          employeeName: target.employee.name,
          branchName: target.branchName,
          role: target.employee.role,
          sales: target.sales,
          cashShifts,
        };
        const wb = generateEmployeeReport(reportData);
        downloadExcel(wb, `reporte_${target.employee.name.replace(/\s+/g, "_")}`);
      }
      toast.success("Reporte descargado");
    } catch (err) {
      toast.error("Error al generar el reporte");
      console.error("[Excel] Error:", err);
    } finally {
      setDownloading(false);
    }
  };

  const handleConfirm = () => {
    if (!target) return;
    // Push deletions to Firestore before actual deletion
    if (target.type === "branch") {
      if (target.saleIds.length > 0) deleteMultipleFromFirestore("sales", target.saleIds);
      if (target.branchUserIds.length > 0) deleteMultipleFromFirestore("branchUsers", target.branchUserIds);
      if (target.productIds.length > 0) deleteMultipleFromFirestore("products", target.productIds);
      if (target.inventoryMovementIds.length > 0) deleteMultipleFromFirestore("inventory_movements", target.inventoryMovementIds);
      if (target.cashShiftIds.length > 0) deleteMultipleFromFirestore("cash_shifts", target.cashShiftIds);
    } else {
      if (target.saleIds.length > 0) deleteMultipleFromFirestore("sales", target.saleIds);
      if (target.cashShiftIds.length > 0) deleteMultipleFromFirestore("cash_shifts", target.cashShiftIds);
    }
    onConfirm();
  };

  if (!target || !summary) return null;

  const SummaryIcon = summary.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            {summary.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning */}
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">
              Esta acción eliminará permanentemente todos los datos asociados:
              ventas, productos, usuarios, traspasos y turnos de caja.
              <strong> No se puede deshacer.</strong>
            </p>
          </div>

          {/* Stats */}
          <div className="grid gap-2">
            {summary.stats.map((stat, i) => {
              const StatIcon = stat.icon;
              return (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                  <StatIcon className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="text-xs text-slate-500">{stat.label}</span>
                  <span className="ml-auto text-sm font-medium text-slate-900">{stat.value}</span>
                </div>
              );
            })}
          </div>

          {/* Excel download */}
          <Button
            variant="outline"
            onClick={handleDownloadExcel}
            disabled={downloading}
            className="w-full border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 gap-2"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {downloading ? "Generando..." : "Descargar Reporte en Excel"}
          </Button>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-slate-200">
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={deleting} variant="destructive" className="gap-2">
            {deleting ? "Eliminando..." : "Eliminar Permanentemente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
