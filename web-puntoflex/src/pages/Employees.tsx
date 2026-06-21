import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  User,
  Shield,
  Key,
  Search,
  Building2,
  Check,
  X,
  ShoppingCart,
  Receipt,
} from "lucide-react";
import { db, type BranchUser, type Branch, type Sale } from "@/db/database";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useSync } from "@/contexts/SyncContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

interface EmployeeForm {
  name: string;
  pin: string;
  role: "admin" | "cajero";
  branchId: string;
  accessibleBranchIds: string[];
}

const emptyForm: EmployeeForm = {
  name: "",
  pin: "",
  role: "cajero",
  branchId: "",
  accessibleBranchIds: [],
};

export default function Employees() {
  const { user } = useAuth();
  const { branches, refreshBranches } = useBranch();
  const { pushBranchUser, deleteFromFirestore } = useSync();
  const queryClient = useQueryClient();
  const businessId = user?.businessId ?? "";

  const [search, setSearch] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("Todas");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<BranchUser | null>(null);
  const [form, setForm] = useState<EmployeeForm>(emptyForm);

  // Sales detail for an employee
  const [salesDialogOpen, setSalesDialogOpen] = useState(false);
  const [selectedEmployeeForSales, setSelectedEmployeeForSales] = useState<BranchUser | null>(null);

  // Load all branch users for this business
  const { data: allEmployees = [], isLoading } = useQuery({
    queryKey: ["allBranchUsers", businessId],
    queryFn: async () => {
      if (!businessId) return [];
      return db.branchUsers.where("businessId").equals(businessId).toArray();
    },
    enabled: !!businessId,
  });

  // Load sales for selected employee
  const { data: employeeSales = [] } = useQuery({
    queryKey: ["employeeSales", selectedEmployeeForSales?.id],
    queryFn: async () => {
      if (!selectedEmployeeForSales || !businessId) return [];
      const all = await db.sales
        .where("businessId").equals(businessId)
        .toArray();
      return all
        .filter((s) => s.branchUserId === selectedEmployeeForSales.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50);
    },
    enabled: !!selectedEmployeeForSales && salesDialogOpen,
  });

  const branchMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of branches) map[b.id] = b.name;
    return map;
  }, [branches]);

  // Filtered employees
  const filtered = useMemo(() => {
    let result = allEmployees;
    if (selectedBranch !== "Todas") {
      result = result.filter((e) => e.branchId === selectedBranch);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) => e.name.toLowerCase().includes(q));
    }
    return result.sort((a, b) => {
      if (a.isOwner) return -1;
      if (b.isOwner) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [allEmployees, selectedBranch, search]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!businessId) throw new Error("No business");
      const data: Omit<BranchUser, "id"> & { id?: string } = {
        id: editingEmployee?.id,
        businessId,
        branchId: form.branchId,
        name: form.name.trim(),
        pin: form.pin.trim(),
        role: form.role,
        isOwner: editingEmployee?.isOwner ?? false,
        accessibleBranchIds: form.role === "admin" ? [] : form.accessibleBranchIds,
        createdAt: editingEmployee?.createdAt ?? Date.now(),
      };
      if (editingEmployee) {
        await db.branchUsers.update(editingEmployee.id, data);
      } else {
        await db.branchUsers.add({ ...data, id: crypto.randomUUID() });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allBranchUsers"] });
      queryClient.invalidateQueries({ queryKey: ["branchUsers"] });
      refreshBranches();
      // Push to Firestore (non-blocking)
      const saved: BranchUser = editingEmployee
        ? { ...editingEmployee, name: form.name.trim(), pin: form.pin.trim(), role: form.role, branchId: form.branchId, accessibleBranchIds: form.role === "admin" ? [] : form.accessibleBranchIds }
        : { id: crypto.randomUUID(), businessId, branchId: form.branchId, name: form.name.trim(), pin: form.pin.trim(), role: form.role, isOwner: false, accessibleBranchIds: form.role === "admin" ? [] : form.accessibleBranchIds, createdAt: Date.now() };
      pushBranchUser(saved);
      setDialogOpen(false);
      setEditingEmployee(null);
      setForm(emptyForm);
      toast.success(editingEmployee ? "Empleado actualizado" : "Empleado creado");
    },
    onError: (err: Error) => toast.error(err.message || "Error al guardar empleado"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (employee: BranchUser) => {
      if (employee.isOwner) throw new Error("No se puede eliminar al dueño del negocio");
      // Check if employee has sales
      const sales = await db.sales
        .where("businessId").equals(businessId)
        .toArray()
        .then((all) => all.filter((s) => s.branchUserId === employee.id));
      if (sales.length > 0) {
        throw new Error(`No se puede eliminar: tiene ${sales.length} ventas registradas. Desactiva al empleado en su lugar.`);
      }
      await db.branchUsers.delete(employee.id);
    },
    onSuccess: (_data: void, employee: BranchUser) => {
      queryClient.invalidateQueries({ queryKey: ["allBranchUsers"] });
      deleteFromFirestore("branchUsers", employee.id);
      toast.success("Empleado eliminado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingEmployee(null);
    setForm({ ...emptyForm, branchId: branches[0]?.id ?? "", accessibleBranchIds: branches.length > 0 ? [branches[0].id] : [] });
    setDialogOpen(true);
  };

  const openEdit = (employee: BranchUser) => {
    setEditingEmployee(employee);
    setForm({
      name: employee.name,
      pin: employee.pin,
      role: employee.role,
      branchId: employee.branchId,
      accessibleBranchIds: employee.accessibleBranchIds.length > 0 ? [...employee.accessibleBranchIds] : [],
    });
    setDialogOpen(true);
  };

  const openSales = (employee: BranchUser) => {
    setSelectedEmployeeForSales(employee);
    setSalesDialogOpen(true);
  };

  const toggleBranchAccess = (branchId: string) => {
    setForm((prev) => {
      const current = prev.accessibleBranchIds;
      if (current.includes(branchId)) {
        return { ...prev, accessibleBranchIds: current.filter((id) => id !== branchId) };
      }
      return { ...prev, accessibleBranchIds: [...current, branchId] };
    });
  };

  const employeeTotalSales = useMemo(() => {
    if (selectedEmployeeForSales) {
      return employeeSales.reduce((sum, s) => sum + s.total, 0);
    }
    return 0;
  }, [employeeSales, selectedEmployeeForSales]);

  // Only the owner can access this page
  if (!user?.isOwner) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-12 text-slate-400">
        <Shield className="mb-4 h-16 w-16 text-slate-300" />
        <p className="text-lg font-medium text-slate-500">Acceso Restringido</p>
        <p className="mt-1 text-sm">Solo el dueño del negocio puede gestionar empleados.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Empleados</h2>
          <p className="text-sm text-slate-500">
            {allEmployees.length} empleado{allEmployees.length !== 1 ? "s" : ""} en tu negocio
          </p>
        </div>
        <Button onClick={openCreate} className="bg-amber-500 hover:bg-amber-600">
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Empleado
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar empleado..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-slate-200 bg-white pl-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Button
            variant="ghost" size="sm"
            onClick={() => setSelectedBranch("Todas")}
            className={cn("shrink-0 rounded-full px-3 text-xs font-medium",
              selectedBranch === "Todas" ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
          >
            Todas
          </Button>
          {branches.map((b) => (
            <Button
              key={b.id} variant="ghost" size="sm"
              onClick={() => setSelectedBranch(b.id)}
              className={cn("shrink-0 rounded-full px-3 text-xs font-medium",
                selectedBranch === b.id ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
            >
              <Building2 className="mr-1 h-3 w-3" />
              {b.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Employee Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 && !isLoading ? (
          <Card className="col-span-full flex flex-col items-center justify-center border-slate-200 p-12 text-slate-400">
            <Users className="mb-3 h-10 w-10" />
            <p className="text-sm">No se encontraron empleados</p>
            <Button onClick={openCreate} variant="outline" size="sm" className="mt-3 border-slate-200">
              <Plus className="mr-1 h-3 w-3" />
              Crear primer empleado
            </Button>
          </Card>
        ) : (
          filtered.map((employee) => (
            <Card
              key={employee.id}
              className={cn(
                "border-slate-200 p-5 transition-all hover:shadow-md",
                employee.isOwner && "ring-2 ring-amber-400 ring-offset-2"
              )}
            >
              {/* Employee Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white",
                    employee.isOwner ? "bg-amber-500" : employee.role === "admin" ? "bg-violet-500" : "bg-slate-500"
                  )}>
                    {employee.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900 truncate">{employee.name}</h3>
                      {employee.isOwner && (
                        <Badge className="bg-amber-500 hover:bg-amber-500 text-[10px]">Dueño</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 capitalize">
                      {employee.role === "admin" ? "Administrador" : "Cajero"}
                      <span className="mx-1.5">·</span>
                      {branchMap[employee.branchId] ?? "Sin sucursal"}
                    </p>
                  </div>
                </div>
                {employee.role === "admin" && !employee.isOwner && (
                  <Shield className="h-4 w-4 text-violet-400 shrink-0" />
                )}
              </div>

              {/* Access Info */}
              <div className="space-y-2 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <Key className="h-3 w-3 shrink-0" />
                  <span>PIN: {employee.pin}</span>
                </div>
                <div className="flex items-start gap-2">
                  <Building2 className="h-3 w-3 shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {employee.accessibleBranchIds.length === 0 ? (
                      <span className="text-violet-500 font-medium">Todas las sucursales</span>
                    ) : (
                      employee.accessibleBranchIds.map((bid) => (
                        <Badge key={bid} variant="secondary" className="text-[10px]">
                          {branchMap[bid] ?? bid}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openSales(employee)}
                  className="flex-1 border-slate-200 text-xs gap-1"
                >
                  <Receipt className="h-3 w-3" />
                  Ventas
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openEdit(employee)}
                  className="h-8 w-8 text-slate-400 hover:text-amber-600"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                {!employee.isOwner && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(employee)}
                    className="h-8 w-8 text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Employee Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEmployee ? "Editar Empleado" : "Nuevo Empleado"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="emp-name">Nombre</Label>
                <Input
                  id="emp-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="border-slate-200"
                  placeholder="Ej. Juan Pérez"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emp-pin">PIN (4 dígitos)</Label>
                <Input
                  id="emp-pin"
                  value={form.pin}
                  onChange={(e) => setForm({ ...form, pin: e.target.value })}
                  className="border-slate-200"
                  placeholder="1234"
                  maxLength={4}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="emp-role">Rol</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as "admin" | "cajero", accessibleBranchIds: v === "admin" ? [] : form.accessibleBranchIds })}>
                  <SelectTrigger className="border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="cajero">Cajero</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="emp-branch">Sucursal principal</Label>
                <Select value={form.branchId} onValueChange={(v) => setForm({ ...form, branchId: v })}>
                  <SelectTrigger className="border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Branch access for cashiers */}
            {form.role === "cajero" && (
              <div className="space-y-2">
                <Label className="text-sm">Sucursales autorizadas (rotación de personal)</Label>
                <p className="text-xs text-slate-500">
                  Marca las sucursales donde este empleado puede iniciar sesión.
                </p>
                <div className="grid gap-1.5 mt-1.5">
                  {branches.map((b) => {
                    const hasAccess = form.accessibleBranchIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => toggleBranchAccess(b.id)}
                        className={cn(
                          "flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-all",
                          hasAccess
                            ? "border-amber-500 bg-amber-50 text-slate-900"
                            : "border-slate-200 text-slate-500 hover:border-slate-300"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Building2 className={cn("h-3.5 w-3.5", hasAccess ? "text-amber-500" : "text-slate-400")} />
                          <span className="text-sm">{b.name}</span>
                        </div>
                        {hasAccess ? (
                          <Check className="h-4 w-4 text-amber-500" />
                        ) : (
                          <X className="h-4 w-4 text-slate-300" />
                        )}
                      </button>
                    );
                  })}
                </div>
                {form.accessibleBranchIds.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">
                    Selecciona al menos una sucursal para que el empleado pueda iniciar sesión.
                  </p>
                )}
              </div>
            )}

            {form.role === "admin" && (
              <div className="rounded-lg bg-violet-50 border border-violet-200 p-3">
                <p className="text-xs text-violet-700 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  Los administradores tienen acceso automático a todas las sucursales.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditingEmployee(null); }} className="border-slate-200">
              Cancelar
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              className="bg-amber-500 hover:bg-amber-600"
              disabled={!form.name.trim() || !form.pin.trim() || !form.branchId || (form.role === "cajero" && form.accessibleBranchIds.length === 0)}
            >
              {editingEmployee ? "Guardar Cambios" : "Crear Empleado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Employee Sales Dialog */}
      <Dialog open={salesDialogOpen} onOpenChange={setSalesDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-amber-500" />
              Ventas de {selectedEmployeeForSales?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Summary */}
            <div className="flex gap-4 rounded-xl bg-slate-50 p-4">
              <div className="flex-1 text-center">
                <p className="text-xs text-slate-500">Total Ventas</p>
                <p className="text-xl font-bold text-slate-900">{formatCurrency(employeeTotalSales)}</p>
              </div>
              <div className="flex-1 text-center border-l border-slate-200">
                <p className="text-xs text-slate-500">Transacciones</p>
                <p className="text-xl font-bold text-slate-900">{employeeSales.length}</p>
              </div>
              <div className="flex-1 text-center border-l border-slate-200">
                <p className="text-xs text-slate-500">Sucursal</p>
                <p className="text-sm font-bold text-slate-900 truncate">
                  {selectedEmployeeForSales ? branchMap[selectedEmployeeForSales.branchId] ?? "—" : "—"}
                </p>
              </div>
            </div>

            {/* Sales list */}
            {employeeSales.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                <Receipt className="mb-2 h-8 w-8" />
                <p className="text-sm">No hay ventas registradas</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {employeeSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {sale.items[0]?.productName ?? "Venta"}
                        {sale.items.length > 1 && ` +${sale.items.length - 1} más`}
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(sale.createdAt).toLocaleDateString("es-MX", {
                          year: "numeric", month: "short", day: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">{formatCurrency(sale.total)}</p>
                      <Badge variant="secondary" className="text-[10px] mt-0.5">
                        {sale.paymentMethod === "cash" ? "Efectivo" : sale.paymentMethod === "card" ? "Tarjeta" : "Transferencia"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
