import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2, Building2, MapPin, Phone, Users, User, Shield, Key } from "lucide-react";
import { db, type Branch, type BranchUser, type Sale } from "@/db/database";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface BranchForm {
  name: string;
  address: string;
  phone: string;
}

const emptyBranchForm: BranchForm = { name: "", address: "", phone: "" };

export default function Branches() {
  const { user } = useAuth();
  const { branches, currentBranch, setCurrentBranch, refreshBranches } = useBranch();
  const { pushBranch, pushBranchUser, deleteFromFirestore } = useSync();
  const queryClient = useQueryClient();
  const businessId = user?.businessId ?? "";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>(emptyBranchForm);

  // Branch user management
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingBranchUser, setEditingBranchUser] = useState<BranchUser | null>(null);
  const [selectedBranchForUsers, setSelectedBranchForUsers] = useState<string>("");
  const [userForm, setUserForm] = useState({ name: "", pin: "", role: "cajero" as "admin" | "cajero" });

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [deleteTargetData, setDeleteTargetData] = useState<{
    sales: Sale[];
    productCount: number;
    inventoryMovementCount: number;
    cashShiftCount: number;
    userCount: number;
    saleIds: string[];
    branchUserIds: string[];
    inventoryMovementIds: string[];
    cashShiftIds: string[];
    productIds: string[];
  } | null>(null);

  const handleDeleteClick = async (branch: Branch) => {
    if (branches.length <= 1) {
      toast.error("Debe existir al menos una sucursal");
      return;
    }
    const [sales, products, branchUsers, inventoryMovements, cashShifts] = await Promise.all([
      db.sales.where("branchId").equals(branch.id).toArray(),
      db.products.where("branchId").equals(branch.id).toArray(),
      db.branchUsers.where("branchId").equals(branch.id).toArray(),
      db.inventoryMovements
        .where("businessId").equals(businessId)
        .toArray()
        .then((all) => all.filter((m) => m.sourceBranchId === branch.id || m.destBranchId === branch.id)),
      db.cashShifts.where("branchId").equals(branch.id).toArray(),
    ]);
    setDeleteTarget(branch);
    setDeleteTargetData({
      sales,
      productCount: products.length,
      inventoryMovementCount: inventoryMovements.length,
      cashShiftCount: cashShifts.length,
      userCount: branchUsers.length,
      saleIds: sales.map((s) => s.id),
      branchUserIds: branchUsers.map((bu) => bu.id),
      inventoryMovementIds: inventoryMovements.map((m) => m.id),
      cashShiftIds: cashShifts.map((cs) => cs.id),
      productIds: products.map((p) => p.id),
    });
    setDeleteConfirmOpen(true);
  };

  // Load branch users for the selected branch
  const { data: branchUsers = [] } = useQuery({
    queryKey: ["branchUsers", selectedBranchForUsers],
    queryFn: async () => {
      if (!selectedBranchForUsers) return [];
      return db.branchUsers.where("branchId").equals(selectedBranchForUsers).toArray();
    },
    enabled: !!selectedBranchForUsers && userDialogOpen,
  });

  const saveBranchMutation = useMutation({
    mutationFn: async () => {
      if (!businessId) throw new Error("No business");
      const id = editingBranch?.id ?? crypto.randomUUID();
      const data: Branch = {
        id,
        businessId,
        name: form.name.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        createdAt: editingBranch?.createdAt ?? Date.now(),
      };
      await db.branches.put(data);
      return { id, isEdit: !!editingBranch };
    },
    onSuccess: (result: { id: string; isEdit: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["branches"] });
      refreshBranches();
      const saved: Branch = editingBranch
        ? { ...editingBranch, name: form.name.trim(), address: form.address.trim(), phone: form.phone.trim() }
        : { id: result.id, businessId, name: form.name.trim(), address: form.address.trim(), phone: form.phone.trim(), createdAt: Date.now() };
      pushBranch(saved);
      setDialogOpen(false);
      setEditingBranch(null);
      setForm(emptyBranchForm);
      toast.success(result.isEdit ? "Sucursal actualizada" : "Sucursal creada");
    },
    onError: () => toast.error("Error al guardar la sucursal"),
  });

  const deleteBranchMutation = useMutation({
    mutationFn: async (id: string) => {
      await db.products.where("branchId").equals(id).delete();
      await db.sales.where("branchId").equals(id).delete();
      await db.branchUsers.where("branchId").equals(id).delete();
      const movements = await db.inventoryMovements
        .where("businessId").equals(businessId)
        .toArray()
        .then((all) => all.filter((m) => m.sourceBranchId === id || m.destBranchId === id));
      for (const m of movements) await db.inventoryMovements.delete(m.id);
      await db.cashShifts.where("branchId").equals(id).delete();
      await db.branches.delete(id);
    },
    onSuccess: (_data: void, id: string) => {
      queryClient.invalidateQueries();
      refreshBranches();
      deleteFromFirestore("branches", id);
      setDeleteConfirmOpen(false);
      setDeleteTarget(null);
      setDeleteTargetData(null);
      toast.success("Sucursal eliminada");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al eliminar");
      setDeleteConfirmOpen(false);
    },
  });

  const saveUserMutation = useMutation({
    mutationFn: async () => {
      if (!businessId || !selectedBranchForUsers) throw new Error("Falta sucursal");
      const id = editingBranchUser?.id ?? crypto.randomUUID();
      const data: BranchUser = {
        id,
        businessId,
        branchId: selectedBranchForUsers,
        name: userForm.name.trim(),
        pin: userForm.pin.trim(),
        role: userForm.role,
        isOwner: editingBranchUser?.isOwner ?? false,
        accessibleBranchIds: editingBranchUser?.accessibleBranchIds ?? [selectedBranchForUsers],
        createdAt: editingBranchUser?.createdAt ?? Date.now(),
      };
      await db.branchUsers.put(data);
      return { id, isEdit: !!editingBranchUser };
    },
    onSuccess: (result: { id: string; isEdit: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["branchUsers"] });
      const saved: BranchUser = editingBranchUser
        ? { ...editingBranchUser, name: userForm.name.trim(), pin: userForm.pin.trim(), role: userForm.role }
        : { id: result.id, businessId, branchId: selectedBranchForUsers, name: userForm.name.trim(), pin: userForm.pin.trim(), role: userForm.role, isOwner: false, accessibleBranchIds: userForm.role === "admin" ? [] : [selectedBranchForUsers], createdAt: Date.now() };
      pushBranchUser(saved);
      setEditingBranchUser(null);
      setUserForm({ name: "", pin: "", role: "cajero" });
      toast.success(result.isEdit ? "Usuario actualizado" : "Usuario creado");
    },
    onError: () => toast.error("Error al guardar el usuario"),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => { await db.branchUsers.delete(id); },
    onSuccess: (_data: void, id: string) => {
      queryClient.invalidateQueries({ queryKey: ["branchUsers"] });
      deleteFromFirestore("branchUsers", id);
      toast.success("Usuario eliminado");
    },
  });

  const openBranchEdit = (b: Branch) => {
    setEditingBranch(b);
    setForm({ name: b.name, address: b.address, phone: b.phone });
    setDialogOpen(true);
  };

  const openBranchCreate = () => {
    setEditingBranch(null);
    setForm(emptyBranchForm);
    setDialogOpen(true);
  };

  const openUserManager = (branchId: string) => {
    setSelectedBranchForUsers(branchId);
    setEditingBranchUser(null);
    setUserForm({ name: "", pin: "", role: "cajero" });
    setUserDialogOpen(true);
  };

  const openUserEdit = (bu: BranchUser) => {
    setEditingBranchUser(bu);
    setUserForm({ name: bu.name, pin: bu.pin, role: bu.role });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Sucursales</h2>
          <p className="text-sm text-slate-500">
            {branches.length} sucursal{branches.length !== 1 ? "es" : ""} en tu negocio
          </p>
        </div>
        <Button onClick={openBranchCreate} className="bg-amber-500 hover:bg-amber-600">
          <Plus className="mr-2 h-4 w-4" />
          Nueva Sucursal
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {branches.map((branch) => {
          const isActive = currentBranch?.id === branch.id;
          return (
            <Card key={branch.id} className={cn("border-slate-200 p-5 transition-all hover:shadow-md", isActive && "ring-2 ring-amber-500 ring-offset-2")}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", isActive ? "bg-amber-500" : "bg-slate-100")}>
                    <Building2 className={cn("h-5 w-5", isActive ? "text-white" : "text-slate-400")} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{branch.name}</h3>
                    {isActive && <span className="text-xs font-medium text-amber-600">Activa</span>}
                  </div>
                </div>
              </div>
              <div className="space-y-2 text-sm text-slate-500">
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{branch.address}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <span>{branch.phone}</span>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                {!isActive && (
                  <Button variant="outline" size="sm" onClick={() => setCurrentBranch(branch)} className="flex-1 border-slate-200 text-xs">
                    Seleccionar
                  </Button>
                )}
                {user?.isOwner && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => openUserManager(branch.id)} className="border-slate-200 text-xs gap-1">
                      <Users className="h-3.5 w-3.5" />
                      Usuarios
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openBranchEdit(branch)} className="h-8 w-8 text-slate-400 hover:text-amber-600">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteClick(branch)} className="h-8 w-8 text-slate-400 hover:text-red-500" disabled={branches.length <= 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {branches.length === 0 && (
        <Card className="flex flex-col items-center justify-center border-slate-200 p-12 text-slate-400">
          <Building2 className="mb-3 h-10 w-10" />
          <p className="text-sm">No hay sucursales configuradas</p>
        </Card>
      )}

      {/* Branch Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBranch ? "Editar Sucursal" : "Nueva Sucursal"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="branch-name">Nombre</Label>
              <Input id="branch-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border-slate-200" placeholder="Ej. Sucursal Centro" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-address">Dirección</Label>
              <Input id="branch-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="border-slate-200" placeholder="Ej. Av. Reforma 123" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-phone">Teléfono</Label>
              <Input id="branch-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="border-slate-200" placeholder="Ej. 555-0101" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditingBranch(null); }} className="border-slate-200">Cancelar</Button>
            <Button onClick={() => saveBranchMutation.mutate()} className="bg-amber-500 hover:bg-amber-600" disabled={saveBranchMutation.isPending || !form.name.trim()}>
              {editingBranch ? "Guardar Cambios" : "Crear Sucursal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Branch Users Dialog */}
      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Usuarios de Sucursal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* User list */}
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {branchUsers.map((bu) => (
                <div key={bu.id} className={cn("flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors", editingBranchUser?.id === bu.id ? "border-amber-500 bg-amber-50" : "border-slate-200")}>
                  <div className="flex items-center gap-2.5">
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white", bu.role === "admin" ? "bg-violet-500" : "bg-slate-400")}>
                      {bu.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{bu.name}</p>
                      <p className="text-[11px] text-slate-500">PIN: {bu.pin} — {bu.role === "admin" ? "Administrador" : "Cajero"}</p>
                    </div>
                    {bu.role === "admin" && <Shield className="h-3.5 w-3.5 text-violet-400" />}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openUserEdit(bu)}>
                      <Pencil className="h-3.5 w-3.5 text-slate-400" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteUserMutation.mutate(bu.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
              {branchUsers.length === 0 && (
                <p className="text-center text-sm text-slate-400 py-6">No hay usuarios en esta sucursal</p>
              )}
            </div>

            {/* Add/Edit user form */}
            <div className="border-t border-slate-100 pt-3 space-y-3">
              <p className="text-sm font-medium">{editingBranchUser ? "Editar usuario" : "Nuevo usuario"}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Nombre</Label>
                  <Input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} className="border-slate-200" placeholder="Nombre" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">PIN</Label>
                  <Input value={userForm.pin} onChange={(e) => setUserForm({ ...userForm, pin: e.target.value })} className="border-slate-200" placeholder="123456" maxLength={6} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Rol</Label>
                  <Select value={userForm.role} onValueChange={(v) => setUserForm({ ...userForm, role: v as "admin" | "cajero" })}>
                    <SelectTrigger className="border-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="cajero">Cajero</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={() => saveUserMutation.mutate()} className="bg-amber-500 hover:bg-amber-600 flex-1" disabled={saveUserMutation.isPending || !userForm.name.trim() || !userForm.pin.trim()}>
                    {editingBranchUser ? "Guardar" : "Agregar"}
                  </Button>
                  {editingBranchUser && (
                    <Button variant="outline" onClick={() => { setEditingBranchUser(null); setUserForm({ name: "", pin: "", role: "cajero" }); }} className="border-slate-200">
                      Cancelar
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      {deleteTarget && deleteTargetData && (
        <DeleteConfirmModal
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          target={{ type: "branch", branch: deleteTarget, ...deleteTargetData }}
          onConfirm={() => deleteBranchMutation.mutate(deleteTarget.id)}
          deleting={deleteBranchMutation.isPending}
        />
      )}
    </div>
  );
}
