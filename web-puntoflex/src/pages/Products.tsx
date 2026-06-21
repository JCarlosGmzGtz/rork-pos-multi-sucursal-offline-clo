import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Package,
  Barcode,
  Tags,
  X,
  Building2,
  Eye,
} from "lucide-react";
import { db, type Product, type BusinessCategory, type Branch } from "@/db/database";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSync } from "@/contexts/SyncContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

interface ProductForm {
  name: string;
  price: string;
  cost: string;
  barcode: string;
  category: string;
  stock: string;
}

const emptyForm: ProductForm = {
  name: "",
  price: "",
  cost: "",
  barcode: "",
  category: "",
  stock: "0",
};

export default function Products() {
  const { user } = useAuth();
  const { currentBranch, refreshBranches } = useBranch();
  const { pushProduct, pushCategory, deleteFromFirestoreAsync } = useSync();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todas");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);

  // Category management
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<BusinessCategory | null>(null);
  const [newCatName, setNewCatName] = useState("");

  // Cross-branch inventory viewing: selected branch to view (default: current)
  const [viewBranchId, setViewBranchId] = useState("");

  const businessId = user?.businessId ?? "";
  const branchId = currentBranch?.id ?? "";

  // Get branches the user can view (for cross-branch inventory)
  const { branches: allBranches } = useBranch();

  // Load the current branch user's accessibleBranchIds
  const { data: currentBranchUser } = useQuery({
    queryKey: ["branchUser", user?.branchUserId],
    queryFn: async () => {
      if (!user?.branchUserId) return null;
      return db.branchUsers.get(user.branchUserId);
    },
    enabled: !!user?.branchUserId,
  });

  const userBranchIds = currentBranchUser?.accessibleBranchIds ?? [];
  const viewableBranches = useMemo(() => {
    if (!user || user.isOwner || user.role === "admin") return allBranches;
    // For cashiers: current branch + accessibleBranchIds
    const ids = new Set([branchId, ...userBranchIds]);
    return allBranches.filter((b) => ids.has(b.id));
  }, [allBranches, branchId, userBranchIds, user]);

  const effectiveViewBranchId = viewBranchId || branchId;

  // Load categories from DB
  const { data: categories = [] } = useQuery({
    queryKey: ["categories", businessId],
    queryFn: async () => {
      if (!businessId) return [];
      return db.categories.where("businessId").equals(businessId).toArray();
    },
    enabled: !!businessId,
  });

  const categoryNames = categories.map((c) => c.name);

  const { data: products = [] } = useQuery({
    queryKey: ["products", businessId, effectiveViewBranchId],
    queryFn: async () => {
      if (!businessId || !effectiveViewBranchId) return [];
      const all = await db.products.where("businessId").equals(businessId).toArray();
      return all.filter((p) => p.branchId === effectiveViewBranchId);
    },
    enabled: !!businessId && !!effectiveViewBranchId,
  });

  const filtered = products.filter((p) => {
    if (selectedCategory !== "Todas" && p.category !== selectedCategory) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.barcode.includes(q);
    }
    return true;
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!businessId || !branchId) throw new Error("No business/branch selected");
      const id = editingProduct?.id ?? crypto.randomUUID();
      const now = editingProduct?.createdAt ?? Date.now();
      const data: Product = {
        id,
        businessId,
        branchId,
        name: form.name.trim(),
        price: Number(form.price) || 0,
        cost: Number(form.cost) || 0,
        barcode: form.barcode.trim(),
        category: form.category,
        stock: Number(form.stock) || 0,
        imageUrl: "",
        createdAt: now,
      };
      if (editingProduct) {
        await db.products.update(editingProduct.id, data);
      } else {
        await db.products.add(data);
      }
      return { id, isEdit: !!editingProduct };
    },
    onSuccess: (result: { id: string; isEdit: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      const saved: Product = {
        id: result.id,
        businessId,
        branchId,
        name: form.name.trim(),
        price: Number(form.price) || 0,
        cost: Number(form.cost) || 0,
        barcode: form.barcode.trim(),
        category: form.category,
        stock: Number(form.stock) || 0,
        imageUrl: "",
        createdAt: editingProduct?.createdAt ?? Date.now(),
      };
      pushProduct(saved);
      setDialogOpen(false);
      setEditingProduct(null);
      setForm(emptyForm);
      toast.success(result.isEdit ? "Producto actualizado" : "Producto creado");
    },
    onError: () => toast.error("Error al guardar el producto"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await db.products.delete(id); },
    onSuccess: (_data: void, id: string) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      deleteFromFirestoreAsync("products", id);
      toast.success("Producto eliminado");
    },
  });

  // Category mutations
  const saveCatMutation = useMutation({
    mutationFn: async () => {
      if (!businessId) throw new Error("No business");
      const name = newCatName.trim();
      if (!name) throw new Error("Nombre requerido");
      if (editingCat) {
        const oldName = editingCat.name;
        await db.categories.update(editingCat.id, { name });
        const prods = await db.products
          .where("businessId").equals(businessId)
          .toArray()
          .then((all) => all.filter((p) => p.category === oldName));
        for (const p of prods) {
          await db.products.update(p.id, { category: name });
        }
        return { id: editingCat.id, isEdit: true };
      }
      const exists = await db.categories.where({ businessId, name }).first();
      if (exists) throw new Error("La categoría ya existe");
      const id = crypto.randomUUID();
      await db.categories.add({ id, businessId, name, createdAt: Date.now() });
      return { id, isEdit: false };
    },
    onSuccess: (result: { id: string; isEdit: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      const cat: BusinessCategory = editingCat
        ? { ...editingCat, name: newCatName.trim() }
        : { id: result.id, businessId, name: newCatName.trim(), createdAt: Date.now() };
      pushCategory(cat);
      setCatDialogOpen(false);
      setEditingCat(null);
      setNewCatName("");
      toast.success(result.isEdit ? "Categoría actualizada" : "Categoría creada");
    },
    onError: (err: Error) => toast.error(err.message || "Error al guardar categoría"),
  });

  const deleteCatMutation = useMutation({
    mutationFn: async (catId: string) => {
      const cat = await db.categories.get(catId);
      if (!cat) return;
      // Check if products use this category
      const count = await db.products
        .where("businessId").equals(businessId)
        .toArray()
        .then((all) => all.filter((p) => p.category === cat.name).length);
      if (count > 0) {
        throw new Error(`No se puede eliminar: ${count} producto(s) usan esta categoría`);
      }
      await db.categories.delete(catId);
    },
    onSuccess: async (_data: void, catId: string) => {
      await deleteFromFirestoreAsync("categories", catId);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Categoría eliminada");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canModify = user?.isOwner || user?.role === "admin";

  const openEdit = (p: Product) => {
    if (!canModify) { toast.error("Solo el dueño o administrador puede modificar productos"); return; }
    setEditingProduct(p);
    setForm({ name: p.name, price: String(p.price), cost: String(p.cost), barcode: p.barcode, category: p.category, stock: String(p.stock) });
    setDialogOpen(true);
  };

  const openCreate = () => {
    if (!canModify) { toast.error("Solo el dueño o administrador puede crear productos"); return; }
    setEditingProduct(null);
    setForm({ ...emptyForm, category: categoryNames[0] ?? "" });
    setDialogOpen(true);
  };

  const openCatEdit = (cat: BusinessCategory) => {
    setEditingCat(cat);
    setNewCatName(cat.name);
    setCatDialogOpen(true);
  };

  const openCatCreate = () => {
    setEditingCat(null);
    setNewCatName("");
    setCatDialogOpen(true);
  };

  if (!currentBranch) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Selecciona una sucursal para ver productos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Productos</h2>
          <p className="text-sm text-slate-500">
            {products.length} productos en {currentBranch.name}
            {!canModify && <span className="ml-1 text-amber-600">— Solo lectura</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {canModify && (
            <>
              <Button variant="outline" onClick={openCatCreate} className="border-slate-200 gap-1.5">
                <Tags className="h-4 w-4" />
                Categorías
              </Button>
              <Button onClick={openCreate} className="bg-amber-500 hover:bg-amber-600">
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Producto
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Cross-branch inventory selector for cashiers */}
      {viewableBranches.length > 1 && effectiveViewBranchId && (
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-500">Viendo inventario de:</span>
          <Select value={effectiveViewBranchId} onValueChange={setViewBranchId}>
            <SelectTrigger className="w-56 h-8 border-slate-200 text-sm">
              <Building2 className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {viewableBranches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {effectiveViewBranchId !== branchId && (
            <Button variant="ghost" size="sm" onClick={() => setViewBranchId(branchId)} className="text-xs text-slate-400 hover:text-amber-600">
              Volver a mi sucursal
            </Button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar por nombre o código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-slate-200 bg-white pl-9"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto flex-wrap">
          <Button
            variant="ghost" size="sm"
            onClick={() => setSelectedCategory("Todas")}
            className={cn("shrink-0 rounded-full px-3 text-xs font-medium",
              selectedCategory === "Todas" ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
          >
            Todas
          </Button>
          {categoryNames.map((cat) => (
            <Button
              key={cat} variant="ghost" size="sm"
              onClick={() => setSelectedCategory(cat)}
              className={cn("shrink-0 rounded-full px-3 text-xs font-medium",
                selectedCategory === cat ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Product List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="flex flex-col items-center justify-center border-slate-200 p-12 text-slate-400">
            <Package className="mb-3 h-10 w-10" />
            <p className="text-sm">No se encontraron productos</p>
          </Card>
        ) : (
          filtered.map((product) => (
            <Card key={product.id} className="flex items-center gap-4 border-slate-200 p-4 transition-shadow hover:shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
                <Barcode className="h-5 w-5 text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-slate-900">{product.name}</p>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">{product.category}</Badge>
                </div>
                <div className="mt-0.5 flex items-center gap-4 text-xs text-slate-500">
                  <span className="tabular-nums">{product.barcode}</span>
                  <span>Stock: <span className={cn("font-medium", product.stock <= 5 && "text-red-500")}>{product.stock}</span></span>
                  <span>Costo: {formatCurrency(product.cost)}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-amber-600">{formatCurrency(product.price)}</p>
              </div>
              <div className="flex gap-1">
                {canModify && (
                  <>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(product)} className="h-8 w-8 text-slate-400 hover:text-amber-600">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(product.id)} className="h-8 w-8 text-slate-400 hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Product Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Editar Producto" : "Nuevo Producto"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border-slate-200" placeholder="Ej. Coca-Cola 600ml" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">Precio de venta</Label>
                <Input id="price" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="border-slate-200" placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cost">Costo</Label>
                <Input id="cost" type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="border-slate-200" placeholder="0.00" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="barcode">Código de barras</Label>
                <Input id="barcode" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="border-slate-200" placeholder="750..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stock">Stock</Label>
                <Input id="stock" type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="border-slate-200" placeholder="0" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Categoría</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger className="border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryNames.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditingProduct(null); }} className="border-slate-200">Cancelar</Button>
            <Button onClick={() => saveMutation.mutate()} className="bg-amber-500 hover:bg-amber-600" disabled={saveMutation.isPending || !form.name.trim() || !form.price}>
              {editingProduct ? "Guardar Cambios" : "Crear Producto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Management Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gestionar Categorías</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Existing categories list */}
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                  <span className="text-sm font-medium">{cat.name}</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openCatEdit(cat)}>
                      <Pencil className="h-3.5 w-3.5 text-slate-400" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteCatMutation.mutate(cat.id)} disabled={deleteCatMutation.isPending}>
                      <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
              {categories.length === 0 && (
                <p className="text-center text-sm text-slate-400 py-4">No hay categorías creadas</p>
              )}
            </div>

            {/* Add/Edit form */}
            <div className="border-t border-slate-100 pt-3">
              <Label className="text-sm">{editingCat ? "Editar categoría" : "Nueva categoría"}</Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="border-slate-200"
                  placeholder="Nombre de la categoría"
                  onKeyDown={(e) => { if (e.key === "Enter") saveCatMutation.mutate(); }}
                />
                <Button onClick={() => saveCatMutation.mutate()} className="bg-amber-500 hover:bg-amber-600 shrink-0" disabled={saveCatMutation.isPending || !newCatName.trim()}>
                  {saveCatMutation.isPending ? "Guardando..." : editingCat ? "Guardar" : "Agregar"}
                </Button>
                {editingCat && (
                  <Button variant="ghost" size="icon" onClick={() => { setEditingCat(null); setNewCatName(""); }} className="h-9 w-9 shrink-0">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
