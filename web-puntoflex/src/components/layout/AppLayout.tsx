import {
  Store,
  ShoppingCart,
  Package,
  Receipt,
  LayoutDashboard,
  Building2,
  ChevronDown,
  Wifi,
  WifiOff,
  Cloud,
  CloudOff,
  RefreshCw,
  Shield,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Upload,
  Download,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSync } from "@/contexts/SyncContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BASE_NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/pos", icon: ShoppingCart, label: "Punto de Venta" },
  { to: "/products", icon: Package, label: "Productos" },
  { to: "/sales", icon: Receipt, label: "Ventas" },
  { to: "/branches", icon: Building2, label: "Sucursales" },
];

const OWNER_NAV = [
  { to: "/employees", icon: Users, label: "Empleados" },
];

export default function AppLayout() {
  const { branches, currentBranch, setCurrentBranch, loading } = useBranch();
  const { user, logout } = useAuth();
  const { syncPendingCount, syncing, lastSyncAt, firestorePath, firebaseConnected, lastSyncResult, syncNow } = useSync();
  const location = useLocation();
  const navigate = useNavigate();
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col bg-slate-900 text-white">
        {/* Logo */}
        <div className="flex items-center gap-3 border-b border-slate-700/60 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500">
            <Store className="h-5 w-5 text-slate-900" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">PuntoFlex</h1>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">
              POS Multi Sucursal
            </p>
          </div>
        </div>

        {/* Branch Switcher */}
        <div className="border-b border-slate-700/60 px-3 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between px-3 py-2 text-slate-200 hover:bg-slate-800 hover:text-white"
              >
                <div className="flex items-center gap-2 truncate">
                  <Building2 className="h-4 w-4 shrink-0 text-amber-400" />
                  <span className="truncate text-sm">
                    {loading ? "Cargando..." : currentBranch?.name ?? "Sin sucursal"}
                  </span>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {branches.map((b) => (
                <DropdownMenuItem
                  key={b.id}
                  onClick={() => setCurrentBranch(b)}
                  className={cn(
                    "cursor-pointer",
                    currentBranch?.id === b.id && "bg-amber-50 font-medium text-amber-700"
                  )}
                >
                  <Building2 className="mr-2 h-4 w-4" />
                  {b.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {BASE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive(item.to)
                  ? "bg-amber-500/15 text-amber-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}

          {/* Owner-only nav items */}
          {user?.isOwner && (
            <>
              <div className="my-2 border-t border-slate-700/60" />
              <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                Administración
              </p>
              {OWNER_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive(item.to)
                      ? "bg-amber-500/15 text-amber-400"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Sidebar Footer — User + Business + Network */}
        <div className="border-t border-slate-700/60 px-4 py-3 space-y-3">
          {/* Business Info */}
          {user && (
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <Store className="h-3 w-3 shrink-0" />
              <span className="truncate">{user.email || "Negocio"}</span>
            </div>
          )}

          {/* User + Branch User Info */}
          {user && (
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-400">
                {user.branchUserName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-200">{user.branchUserName}</p>
                <p className="flex items-center gap-1 truncate text-[10px] text-slate-500">
                  {user.role === "admin" && <Shield className="h-2.5 w-2.5 text-violet-400" />}
                  {user.role === "admin" ? "Administrador" : "Cajero"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await logout();
                  navigate("/login");
                }}
                className="h-7 px-2 text-[10px] text-slate-500 hover:text-red-400"
              >
                Salir
              </Button>
            </div>
          )}

          {/* ── Sync & Firebase Panel ── */}
          <div className="space-y-2 rounded-lg bg-slate-800/50 p-3">
            {/* Firebase Status Row */}
            <div className="flex items-center gap-2 text-[10px]">
              {firebaseConnected ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              ) : (
                <XCircle className="h-3 w-3 text-slate-500" />
              )}
              <span className={firebaseConnected ? "text-emerald-400" : "text-slate-500"}>
                {firebaseConnected ? "Firestore conectado" : "Firestore sin conexión"}
              </span>
            </div>

            {/* Firestore Path */}
            {firebaseConnected && firestorePath && (
              <p className="truncate text-[9px] font-mono text-slate-600" title={`Colección: ${firestorePath}`}>
                /{firestorePath}
              </p>
            )}

            {/* Sync Stats Row */}
            <div className="flex items-center justify-between gap-2">
              {/* Pending count */}
              <div className="flex items-center gap-1.5">
                {online ? (
                  <Cloud className="h-3 w-3 text-slate-400" />
                ) : (
                  <CloudOff className="h-3 w-3 text-red-400" />
                )}
                <span className={cn("text-[10px]", syncPendingCount > 0 ? "text-amber-400 font-medium" : "text-slate-500")}>
                  {syncPendingCount > 0
                    ? `${syncPendingCount} pendiente${syncPendingCount !== 1 ? "s" : ""}`
                    : "Todo sincronizado"}
                </span>
              </div>

              {/* Manual Sync Button */}
              {online && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={syncing}
                  onClick={() => syncNow()}
                  className="h-6 gap-1 px-2 text-[10px] text-amber-400 hover:bg-slate-700 hover:text-amber-300"
                  title="Forzar sincronización ahora"
                >
                  <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
                  {syncing ? "Sync..." : "Sync"}
                </Button>
              )}
            </div>

            {/* Last Sync Time */}
            {lastSyncAt && (
              <div className="flex items-center gap-1.5 text-[9px] text-slate-600">
                <Clock className="h-2.5 w-2.5" />
                <span>
                  Última sync: hace {Math.round((Date.now() - lastSyncAt) / 60000)} min
                </span>
              </div>
            )}

            {/* Last Sync Result Detail */}
            {lastSyncResult && (lastSyncResult.pushed > 0 || lastSyncResult.error) && (
              <div className="space-y-0.5 border-t border-slate-700/40 pt-1.5">
                {lastSyncResult.pushed > 0 && (
                  <div className="flex items-center gap-1 text-[9px] text-emerald-400">
                    <Upload className="h-2.5 w-2.5" />
                    <span>{lastSyncResult.pushed} ventas subidas</span>
                  </div>
                )}
                {lastSyncResult.pulled > 0 && (
                  <div className="flex items-center gap-1 text-[9px] text-blue-400">
                    <Download className="h-2.5 w-2.5" />
                    <span>{lastSyncResult.pulled} productos bajados</span>
                  </div>
                )}
                {lastSyncResult.error && (
                  <p className="truncate text-[9px] text-red-400" title={lastSyncResult.error}>
                    Error: {lastSyncResult.error}
                  </p>
                )}
              </div>
            )}
          </div>

          <p className="text-[10px] text-slate-600">
            v3.0
            {user && (
              <span className="ml-2 text-slate-500">
                &middot; {user.businessId.slice(0, 8)}
              </span>
            )}
          </p>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Offline Alert Banner */}
        {!online && (
          <div className="flex items-center justify-center gap-2 bg-red-500 px-4 py-2 text-sm font-medium text-white">
            <WifiOff className="h-4 w-4" />
            <span>Sin conexión a internet</span>
            {syncPendingCount > 0 && (
              <Badge className="ml-2 bg-white/20 text-white hover:bg-white/20">
                {syncPendingCount} ticket{syncPendingCount !== 1 ? "s" : ""} pendiente{syncPendingCount !== 1 ? "s" : ""}
              </Badge>
            )}
            <span className="text-xs opacity-80">
              — Las ventas se sincronizarán automáticamente al reconectar
            </span>
          </div>
        )}

        {/* Syncing indicator */}
        {online && syncing && (
          <div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-xs font-medium text-white">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>Sincronizando {syncPendingCount} ticket{syncPendingCount !== 1 ? "s" : ""}...</span>
          </div>
        )}

        {/* Page Content */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
