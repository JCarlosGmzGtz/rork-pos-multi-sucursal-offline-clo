import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Search,
  Receipt,
  CreditCard,
  Banknote,
  ArrowRightLeft,
  Calendar,
  ChevronDown,
  User,
  BarChart3,
  TrendingUp,
  DollarSign,
} from "lucide-react";
import { db, type Sale, type BranchUser } from "@/db/database";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type CutoffPeriod = "7d" | "15d" | "30d";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateShort(ts: number): string {
  return new Date(ts).toLocaleDateString("es-MX", {
    month: "short",
    day: "numeric",
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PAYMENT_ICONS: Record<Sale["paymentMethod"], typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  transfer: ArrowRightLeft,
};

const PAYMENT_LABELS: Record<Sale["paymentMethod"], string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
};

const CUTOFF_OPTIONS: { value: CutoffPeriod; label: string }[] = [
  { value: "7d", label: "7 días" },
  { value: "15d", label: "15 días" },
  { value: "30d", label: "30 días" },
];

function getCutoffStart(period: CutoffPeriod): number {
  const days = period === "7d" ? 7 : period === "15d" ? 15 : 30;
  const now = Date.now();
  // Set start to beginning of that day (00:00:00)
  const d = new Date(now - days * 24 * 60 * 60 * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function Sales() {
  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const [search, setSearch] = useState("");
  const [expandedSale, setExpandedSale] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [cutoffPeriod, setCutoffPeriod] = useState<CutoffPeriod>("7d");

  const businessId = user?.businessId ?? "";

  // Load branch users to show cashier names
  const { data: branchUsers = [] } = useQuery({
    queryKey: ["branchUsersForSales", businessId],
    queryFn: async () => {
      if (!businessId) return [];
      return db.branchUsers.where("businessId").equals(businessId).toArray();
    },
    enabled: !!businessId,
  });

  const branchUserMap = useMemo(() => {
    const map: Record<string, BranchUser> = {};
    for (const bu of branchUsers) map[bu.id] = bu;
    return map;
  }, [branchUsers]);

  const { data: sales = [] } = useQuery({
    queryKey: ["sales", businessId, currentBranch?.id],
    queryFn: async () => {
      if (!businessId || !currentBranch) return [];
      const all = await db.sales.where("businessId").equals(businessId).toArray();
      return all
        .filter((s) => s.branchId === currentBranch.id)
        .reverse()
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    enabled: !!businessId && !!currentBranch,
  });

  const filtered = sales.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.items.some((i) => i.productName.toLowerCase().includes(q)) ||
      formatCurrency(s.total).includes(q) ||
      formatDate(s.createdAt).toLowerCase().includes(q)
    );
  });

  const totalRevenue = filtered.reduce((sum, s) => sum + s.total, 0);

  // --- Report Calculations ---
  const cutoffStart = getCutoffStart(cutoffPeriod);
  const reportSales = useMemo(() => {
    return sales.filter((s) => s.createdAt >= cutoffStart);
  }, [sales, cutoffStart]);

  const reportStats = useMemo(() => {
    const stats = {
      totalRevenue: 0,
      count: reportSales.length,
      byMethod: {} as Record<string, { count: number; total: number }>,
      dailyBreakdown: {} as Record<string, { count: number; total: number }>,
      averageTicket: 0,
    };

    for (const sale of reportSales) {
      stats.totalRevenue += sale.total;

      // By payment method
      if (!stats.byMethod[sale.paymentMethod]) {
        stats.byMethod[sale.paymentMethod] = { count: 0, total: 0 };
      }
      stats.byMethod[sale.paymentMethod].count++;
      stats.byMethod[sale.paymentMethod].total += sale.total;

      // Daily breakdown
      const dayKey = formatDateShort(sale.createdAt);
      if (!stats.dailyBreakdown[dayKey]) {
        stats.dailyBreakdown[dayKey] = { count: 0, total: 0 };
      }
      stats.dailyBreakdown[dayKey].count++;
      stats.dailyBreakdown[dayKey].total += sale.total;
    }

    stats.averageTicket = stats.count > 0 ? stats.totalRevenue / stats.count : 0;
    return stats;
  }, [reportSales]);

  const sortedDailyBreakdown = useMemo(() => {
    return Object.entries(reportStats.dailyBreakdown).sort((a, b) =>
      b[0].localeCompare(a[0]),
    );
  }, [reportStats.dailyBreakdown]);

  if (!currentBranch) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Selecciona una sucursal para ver ventas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Historial de Ventas</h2>
          <p className="text-sm text-slate-500">{sales.length} ventas en {currentBranch.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total en vista</p>
            <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalRevenue)}</p>
          </div>
          <Button
            variant={showReport ? "default" : "outline"}
            size="sm"
            onClick={() => setShowReport(!showReport)}
            className={showReport ? "bg-amber-500 hover:bg-amber-600" : "border-slate-200"}
          >
            <BarChart3 className="mr-1.5 h-4 w-4" />
            Corte
          </Button>
        </div>
      </div>

      {/* Report / Cut Section */}
      {showReport && (
        <Card className="border-amber-200 bg-amber-50/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-amber-600" />
              <h3 className="font-semibold text-slate-800">Corte de Ventas</h3>
            </div>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {CUTOFF_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCutoffPeriod(opt.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                    cutoffPeriod === opt.value
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Summary Cards */}
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Total de ventas
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {formatCurrency(reportStats.totalRevenue)}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {reportStats.count} transacciones
              </p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Ticket promedio
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {formatCurrency(reportStats.averageTicket)}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                por venta
              </p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Efectivo
              </p>
              <p className="mt-1 text-2xl font-bold text-emerald-600">
                {formatCurrency(reportStats.byMethod.cash?.total ?? 0)}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {reportStats.byMethod.cash?.count ?? 0} ventas
              </p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Tarjeta / Transferencia
              </p>
              <p className="mt-1 text-2xl font-bold text-blue-600">
                {formatCurrency((reportStats.byMethod.card?.total ?? 0) + (reportStats.byMethod.transfer?.total ?? 0))}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {(reportStats.byMethod.card?.count ?? 0) + (reportStats.byMethod.transfer?.count ?? 0)} ventas
              </p>
            </div>
          </div>

          {/* Daily Breakdown Table */}
          {sortedDailyBreakdown.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                Desglose diario
              </p>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Día</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Ventas</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDailyBreakdown.map(([day, data]) => (
                      <tr key={day} className="border-t border-slate-100">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{day}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{data.count}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">
                          {formatCurrency(data.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                      <td className="px-4 py-2.5 text-slate-700">Total</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{reportStats.count}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                        {formatCurrency(reportStats.totalRevenue)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Empty state */}
          {sortedDailyBreakdown.length === 0 && (
            <div className="flex flex-col items-center py-8 text-slate-400">
              <DollarSign className="mb-2 h-8 w-8" />
              <p className="text-sm">Sin ventas en este periodo</p>
            </div>
          )}
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Buscar por producto, total o fecha..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-slate-200 bg-white pl-9"
        />
      </div>

      {/* Sales List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card className="flex flex-col items-center justify-center border-slate-200 p-12 text-slate-400">
            <Receipt className="mb-3 h-10 w-10" />
            <p className="text-sm">No se encontraron ventas</p>
          </Card>
        ) : (
          filtered.map((sale) => {
            const Icon = PAYMENT_ICONS[sale.paymentMethod];
            const isExpanded = expandedSale === sale.id;
            return (
              <Collapsible
                key={sale.id}
                open={isExpanded}
                onOpenChange={(open) => setExpandedSale(open ? sale.id : null)}
              >
                <Card className="border-slate-200 transition-shadow hover:shadow-sm">
                  <CollapsibleTrigger asChild>
                    <div className="flex cursor-pointer items-center gap-4 p-4">
                      <div
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-lg",
                          sale.paymentMethod === "cash"
                            ? "bg-emerald-50"
                            : sale.paymentMethod === "card"
                              ? "bg-blue-50"
                              : "bg-violet-50",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-5 w-5",
                            sale.paymentMethod === "cash"
                              ? "text-emerald-600"
                              : sale.paymentMethod === "card"
                                ? "text-blue-600"
                                : "text-violet-600",
                          )}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900">
                            {sale.items[0]?.productName ?? "Venta"}
                            {sale.items.length > 1 && ` +${sale.items.length - 1}`}
                          </p>
                          <Badge variant="secondary" className="text-[10px]">
                            {PAYMENT_LABELS[sale.paymentMethod]}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(sale.createdAt)}
                          </span>
                          <span>
                            {sale.items.length} artículo{sale.items.length !== 1 ? "s" : ""}
                          </span>
                          {sale.branchUserId && branchUserMap[sale.branchUserId] && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {branchUserMap[sale.branchUserId].name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-slate-900">
                          {formatCurrency(sale.total)}
                        </p>
                        {sale.paymentMethod === "cash" && sale.change > 0 && (
                          <p className="text-xs text-slate-400">
                            Cambio: {formatCurrency(sale.change)}
                          </p>
                        )}
                      </div>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-slate-400 transition-transform",
                          isExpanded && "rotate-180",
                        )}
                      />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t border-slate-100 px-4 pb-4">
                      <div className="mt-3 space-y-2">
                        {sale.items.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-sm"
                          >
                            <span className="text-slate-600">
                              {item.productName} x{item.quantity}
                            </span>
                            <span className="tabular-nums text-slate-900 font-medium">
                              {formatCurrency(item.subtotal)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex justify-between border-t border-slate-100 pt-2 text-sm">
                        <span className="text-slate-500">
                          {sale.branchUserId && branchUserMap[sale.branchUserId]
                            ? `Atendió: ${branchUserMap[sale.branchUserId].name}`
                            : "Hora"}
                        </span>
                        <span className="text-slate-700">{formatTime(sale.createdAt)}</span>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })
        )}
      </div>
    </div>
  );
}
