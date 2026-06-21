import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  ArrowRightLeft,
  Building2,
  Package,
  Search,
  ChevronDown,
  Send,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { db, type InventoryMovement, type Product, type Branch } from "@/db/database";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSync } from "@/contexts/SyncContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

export default function Transfers() {
  const { user } = useAuth();
  const { branches, currentBranch } = useBranch();
  const { pushInventoryMovement, pushProduct } = useSync();
  const queryClient = useQueryClient();

  const [sourceBranchId, setSourceBranchId] = useState("");
  const [destBranchId, setDestBranchId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expandedMovement, setExpandedMovement] = useState<string | null>(null);

  const businessId = user?.businessId ?? "";

  // Only owners and admins can access this page
  const canAccess = user?.isOwner || user?.role === "admin";

  // Load all products for the business
  const { data: allProducts = [] } = useQuery({
    queryKey: ["products", businessId, "allBranches"],
    queryFn: async () => {
      if (!businessId) return [];
      return db.products.where("businessId").equals(businessId).toArray();
    },
    enabled: !!businessId && canAccess,
  });

  // Products filtered by selected source branch
  const sourceProducts = useMemo(() => {
    if (!sourceBranchId) return [];
    return allProducts.filter((p) => p.branchId === sourceBranchId);
  }, [allProducts, sourceBranchId]);

  // The currently selected product object
  const selectedProduct = useMemo(() => {
    if (!selectedProductId) return null;
    return sourceProducts.find((p) => p.id === selectedProductId) ?? null;
  }, [sourceProducts, selectedProductId]);

  // Load inventory movements history
  const { data: movements = [] } = useQuery({
    queryKey: ["inventoryMovements", businessId],
    queryFn: async () => {
      if (!businessId) return [];
      const all = await db.inventoryMovements
        .where("businessId")
        .equals(businessId)
        .toArray();
      return all.sort((a, b) => b.createdAt - a.createdAt);
    },
    enabled: !!businessId && canAccess,
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!businessId || !sourceBranchId || !destBranchId || !selectedProduct || !quantity) {
        throw new Error("Completa todos los campos");
      }

      const qty = Number(quantity);
      if (qty <= 0 || !Number.isInteger(qty)) {
        throw new Error("La cantidad debe ser un número entero positivo");
      }

      if (sourceBranchId === destBranchId) {
        throw new Error("La sucursal origen y destino no pueden ser la misma");
      }

      if (qty > selectedProduct.stock) {
        throw new Error(
          `Stock insuficiente. ${selectedProduct.name} solo tiene ${selectedProduct.stock} unidades en la sucursal origen.`,
        );
      }

      // Find the product in the destination branch (if it exists)
      const destProduct = await db.products
        .where("businessId")
        .equals(businessId)
        .toArray()
        .then((all) =>
          all.find(
            (p) =>
              p.branchId === destBranchId && p.name === selectedProduct.name,
          ),
        );

      // Subtract from source
      await db.products.update(selectedProduct.id, {
        stock: selectedProduct.stock - qty,
      });

      // Add to destination (create if not exists)
      let destProductId: string;
      if (destProduct) {
        destProductId = destProduct.id;
        await db.products.update(destProduct.id, {
          stock: destProduct.stock + qty,
        });
      } else {
        destProductId = crypto.randomUUID();
        await db.products.add({
          id: destProductId,
          businessId,
          branchId: destBranchId,
          name: selectedProduct.name,
          price: selectedProduct.price,
          cost: selectedProduct.cost,
          barcode: selectedProduct.barcode,
          category: selectedProduct.category,
          stock: qty,
          imageUrl: selectedProduct.imageUrl,
          createdAt: Date.now(),
        });
      }

      // Record the movement
      const movementId = crypto.randomUUID();
      const sourceBranch = branches.find((b) => b.id === sourceBranchId);
      const destBranch = branches.find((b) => b.id === destBranchId);

      await db.inventoryMovements.add({
        id: movementId,
        businessId,
        sourceBranchId,
        sourceBranchName: sourceBranch?.name ?? sourceBranchId,
        destBranchId,
        destBranchName: destBranch?.name ?? destBranchId,
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        quantity: qty,
        transferredBy: user?.branchUserId ?? "",
        transferredByName: user?.branchUserName ?? "",
        createdAt: Date.now(),
      });

      return { movementId, sourceBranchName: sourceBranch?.name ?? sourceBranchId, destBranchName: destBranch?.name ?? destBranchId, destProductId };
    },
    onSuccess: (result: { movementId: string; sourceBranchName: string; destBranchName: string; destProductId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventoryMovements"] });
      const movement: InventoryMovement = {
        id: result.movementId,
        businessId,
        sourceBranchId,
        sourceBranchName: result.sourceBranchName,
        destBranchId,
        destBranchName: result.destBranchName,
        productId: selectedProduct!.id,
        productName: selectedProduct!.name,
        quantity: Number(quantity),
        transferredBy: user?.branchUserId ?? "",
        transferredByName: user?.branchUserName ?? "",
        createdAt: Date.now(),
      };
      pushInventoryMovement(movement);
      // Push source product update
      pushProduct({ ...selectedProduct!, stock: selectedProduct!.stock - Number(quantity) });
      // Push destination product
      db.products.get(result.destProductId).then((dest) => {
        if (dest) pushProduct(dest);
      });
      setSourceBranchId("");
      setDestBranchId("");
      setSelectedProductId("");
      setQuantity("");
      toast.success("Traspaso realizado con éxito");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al realizar el traspaso");
    },
  });

  if (!canAccess) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-500">
            Solo el dueño o administrador puede realizar traspasos.
          </p>
        </div>
      </div>
    );
  }

  const availableBranches = branches.filter((b) => b.id !== sourceBranchId);
  const canSubmit =
    sourceBranchId &&
    destBranchId &&
    selectedProductId &&
    quantity &&
    Number(quantity) > 0 &&
    Number.isInteger(Number(quantity));

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Traspasos
          </h2>
          <p className="text-sm text-slate-500">
            Transferir inventario entre sucursales
          </p>
        </div>
        <Badge className="shrink-0 bg-violet-100 text-violet-700 hover:bg-violet-100">
          <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
          {movements.length} movimientos
        </Badge>
      </div>

      {/* Transfer Form */}
      <Card className="border-slate-200 p-5 shadow-sm">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Send className="h-4 w-4 text-amber-500" />
          Nuevo Traspaso
        </h3>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Source Branch */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">
              Sucursal Origen
            </label>
            <Select value={sourceBranchId} onValueChange={(v) => { setSourceBranchId(v); setSelectedProductId(""); }}>
              <SelectTrigger className="h-9 border-slate-200 text-sm">
                <Building2 className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Destination Branch */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">
              Sucursal Destino
            </label>
            <Select
              value={destBranchId}
              onValueChange={setDestBranchId}
              disabled={!sourceBranchId}
            >
              <SelectTrigger className="h-9 border-slate-200 text-sm">
                <Building2 className="mr-1.5 h-3.5 w-3.5 text-violet-400" />
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {availableBranches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Product */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">
              Producto
            </label>
            <Select
              value={selectedProductId}
              onValueChange={setSelectedProductId}
              disabled={!sourceBranchId || sourceProducts.length === 0}
            >
              <SelectTrigger className="h-9 border-slate-200 text-sm">
                <Package className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {sourceProducts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} (Stock: {p.stock})
                  </SelectItem>
                ))}
                {sourceBranchId && sourceProducts.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-slate-400">
                    Sin productos en esta sucursal
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">
              Cantidad
            </label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="1"
                max={selectedProduct?.stock ?? 9999}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                disabled={!selectedProduct}
                className="h-9 border-slate-200 text-sm [&::-webkit-inner-spin-button]:appearance-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") transferMutation.mutate();
                }}
              />
              <Button
                onClick={() => transferMutation.mutate()}
                disabled={!canSubmit || transferMutation.isPending}
                className="h-9 shrink-0 bg-amber-500 px-4 hover:bg-amber-600"
              >
                {transferMutation.isPending ? (
                  <span className="flex items-center gap-1">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ...
                  </span>
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            {selectedProduct && (
              <p className="text-[11px] text-slate-400">
                Stock disponible: {selectedProduct.stock} unidades
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Movement History */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          Historial de Traspasos
        </h3>

        {movements.length === 0 ? (
          <Card className="flex flex-col items-center justify-center border-slate-200 p-12 text-slate-400">
            <ArrowRightLeft className="mb-3 h-10 w-10" />
            <p className="text-sm">No hay traspasos registrados</p>
            <p className="mt-1 text-xs">
              Usa el formulario superior para hacer tu primer traspaso
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {movements.map((mov) => {
              const isExpanded = expandedMovement === mov.id;
              return (
                <Collapsible
                  key={mov.id}
                  open={isExpanded}
                  onOpenChange={(open) =>
                    setExpandedMovement(open ? mov.id : null)
                  }
                >
                  <Card className="border-slate-200 transition-shadow hover:shadow-sm">
                    <CollapsibleTrigger asChild>
                      <div className="flex cursor-pointer items-center gap-4 p-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50">
                          <ArrowRightLeft className="h-5 w-5 text-violet-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-medium text-slate-900">
                              {mov.productName}
                            </p>
                            <Badge
                              variant="secondary"
                              className="shrink-0 text-[10px]"
                            >
                              x{mov.quantity}
                            </Badge>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {mov.sourceBranchName} → {mov.destBranchName}
                            </span>
                            <span>{formatDate(mov.createdAt)}</span>
                            <span className="text-slate-300">
                              por {mov.transferredByName}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="text-sm font-semibold text-violet-600">
                            {mov.quantity} uds
                          </span>
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
                        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                          <div>
                            <span className="text-xs text-slate-400">
                              Origen
                            </span>
                            <p className="font-medium text-slate-700">
                              {mov.sourceBranchName}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400">
                              Destino
                            </span>
                            <p className="font-medium text-slate-700">
                              {mov.destBranchName}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400">
                              Producto
                            </span>
                            <p className="font-medium text-slate-700">
                              {mov.productName}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400">
                              Cantidad
                            </span>
                            <p className="font-medium text-slate-700">
                              {mov.quantity} unidades
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400">
                              Realizado por
                            </span>
                            <p className="font-medium text-slate-700">
                              {mov.transferredByName}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400">
                              Fecha
                            </span>
                            <p className="font-medium text-slate-700">
                              {formatDate(mov.createdAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
