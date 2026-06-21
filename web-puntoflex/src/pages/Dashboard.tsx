import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  TrendingUp,
  ShoppingCart,
  DollarSign,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  FlaskConical,
} from "lucide-react";
import { db } from "@/db/database";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSync } from "@/contexts/SyncContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

function TestSaleButton() {
  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const { notifySaleCreated } = useSync();
  const [creating, setCreating] = useState(false);

  const createTestSale = useCallback(async () => {
    if (!user || !currentBranch) return;
    setCreating(true);
    try {
      const businessId = user.businessId;
      const branchId = currentBranch.id;
      const testProductId = crypto.randomUUID();

      // Ensure a test product exists
      const existing = await db.products
        .where("businessId").equals(businessId)
        .toArray()
        .then((all) => all.filter((p) => p.branchId === branchId));

      let productId = existing[0]?.id;
      let productName = existing[0]?.name ?? "Producto de prueba";
      let productPrice = existing[0]?.price ?? 99;

      if (!productId) {
        productId = testProductId;
        await db.products.add({
          id: productId,
          businessId,
          branchId,
          name: "Producto de prueba",
          price: 99,
          cost: 50,
          barcode: "TEST001",
          category: "General",
          stock: 999,
          imageUrl: "",
          createdAt: Date.now(),
        });
      }

      await db.sales.add({
        id: crypto.randomUUID(),
        businessId,
        branchId,
        branchUserId: user.branchUserId,
        items: [{
          productId,
          productName,
          quantity: 1,
          unitPrice: productPrice,
          subtotal: productPrice,
        }],
        total: productPrice,
        paymentMethod: "cash",
        amountPaid: productPrice,
        change: 0,
        customerEmail: "",
        shiftId: "",
        createdAt: Date.now(),
        synced: 0,
      });

      console.log(`[Test] Venta de prueba creada — ${productName} $${productPrice}`);
      notifySaleCreated();
      toast.success("Venta de prueba creada. Revisá el panel de Sync en la barra lateral.");
    } catch (err) {
      toast.error("Error al crear venta de prueba");
      console.error("[Test] Error:", err);
    } finally {
      setCreating(false);
    }
  }, [user, currentBranch, notifySaleCreated]);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={creating || !user || !currentBranch}
      onClick={createTestSale}
      className="gap-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
    >
      <FlaskConical className="h-4 w-4" />
      {creating ? "Creando..." : "Venta de prueba (sync test)"}
    </Button>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const businessId = user?.businessId ?? "";

  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ["dashboard", businessId, currentBranch?.id],
    queryFn: async () => {
      if (!businessId || !currentBranch) return null;
      const branchId = currentBranch.id;
      const now = Date.now();
      const todayStartTs = todayStart();
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

      const [allSales, products] = await Promise.all([
        db.sales.where("businessId").equals(businessId).toArray().then((all) => all.filter((s) => s.branchId === branchId)),
        db.products.where("businessId").equals(businessId).toArray().then((all) => all.filter((p) => p.branchId === branchId)),
      ]);

      const todaySales = allSales.filter((s) => s.createdAt >= todayStartTs);
      const todayRevenue = todaySales.reduce((sum, s) => sum + s.total, 0);
      const todayTransactions = todaySales.length;

      const yesterdayStart = todayStartTs - 24 * 60 * 60 * 1000;
      const yesterdaySales = allSales.filter(
        (s) => s.createdAt >= yesterdayStart && s.createdAt < todayStartTs
      );
      const yesterdayRevenue = yesterdaySales.reduce((sum, s) => sum + s.total, 0);

      const revenueChange =
        yesterdayRevenue > 0
          ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
          : todayRevenue > 0
            ? 100
            : 0;

      const lowStock = products.filter((p) => p.stock <= 10).length;
      const totalProducts = products.length;

      const chartData: { name: string; ventas: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const dayStart = new Date();
        dayStart.setDate(dayStart.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = dayStart.getTime() + 24 * 60 * 60 * 1000;
        const daySales = allSales.filter(
          (s) => s.createdAt >= dayStart.getTime() && s.createdAt < dayEnd
        );
        const dayTotal = daySales.reduce((sum, s) => sum + s.total, 0);
        const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
        chartData.push({ name: days[dayStart.getDay()], ventas: Math.round(dayTotal * 100) / 100 });
      }

      return { todayRevenue, todayTransactions, revenueChange, lowStock, totalProducts, chartData };
    },
    enabled: !!businessId && !!currentBranch,
  });

  if (!currentBranch) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Selecciona una sucursal para ver el dashboard.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h2>
          <p className="text-sm text-slate-500">{currentBranch.name}</p>
        </div>
        <TestSaleButton />
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-200 p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Ventas Hoy</p>
              <p className="text-2xl font-bold text-slate-900">{isLoading ? "—" : formatCurrency(dashboardData?.todayRevenue ?? 0)}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2"><DollarSign className="h-5 w-5 text-emerald-600" /></div>
          </div>
          {dashboardData && (
            <div className="mt-2 flex items-center gap-1 text-xs">
              {dashboardData.revenueChange >= 0 ? (
                <><ArrowUpRight className="h-3 w-3 text-emerald-600" /><span className="text-emerald-600">+{dashboardData.revenueChange.toFixed(1)}%</span></>
              ) : (
                <><ArrowDownRight className="h-3 w-3 text-red-500" /><span className="text-red-500">{dashboardData.revenueChange.toFixed(1)}%</span></>
              )}
              <span className="text-slate-400">vs ayer</span>
            </div>
          )}
        </Card>

        <Card className="border-slate-200 p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Transacciones</p>
              <p className="text-2xl font-bold text-slate-900">{isLoading ? "—" : dashboardData?.todayTransactions ?? 0}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-2"><ShoppingCart className="h-5 w-5 text-blue-600" /></div>
          </div>
          <p className="mt-3 text-xs text-slate-400">Total de ventas realizadas hoy</p>
        </Card>

        <Card className="border-slate-200 p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Productos</p>
              <p className="text-2xl font-bold text-slate-900">{isLoading ? "—" : dashboardData?.totalProducts ?? 0}</p>
            </div>
            <div className="rounded-lg bg-violet-50 p-2"><Package className="h-5 w-5 text-violet-600" /></div>
          </div>
          <p className="mt-3 text-xs text-slate-400">{dashboardData ? `${dashboardData.lowStock} con stock bajo` : ""}</p>
        </Card>

        <Card className="border-slate-200 p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Tendencia</p>
              <p className="text-2xl font-bold text-slate-900">{isLoading ? "—" : dashboardData && dashboardData.revenueChange >= 0 ? "Al alza" : "A la baja"}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-2"><TrendingUp className="h-5 w-5 text-amber-600" /></div>
          </div>
          <p className="mt-3 text-xs text-slate-400">Comparado con ayer</p>
        </Card>
      </div>

      {/* Chart */}
      <Card className="border-slate-200 p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-700">Ventas — Últimos 7 Días</h3>
        {dashboardData?.chartData ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dashboardData.chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }} formatter={(value: number) => [formatCurrency(value), "Ventas"]} />
                <Bar dataKey="ventas" fill="#f59e0b" radius={[6, 6, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center"><p className="text-sm text-slate-400">Cargando datos...</p></div>
        )}
      </Card>
    </div>
  );
}
