import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Banknote,
  ArrowRightLeft,
  X,
  ShoppingCart,
  Barcode,
  PackageOpen,
  WifiOff,
  Mail,
  ArrowDownToLine,
  Clock,
} from "lucide-react";
import { db, type Product, type Sale } from "@/db/database";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { useSync } from "@/contexts/SyncContext";
import { useCashShift } from "@/contexts/CashShiftContext";
import { usePeripherals } from "@/contexts/PeripheralsContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import SaleSuccessModal from "@/components/SaleSuccessModal";
import OpenShiftModal from "@/components/OpenShiftModal";
import CloseShiftModal from "@/components/CloseShiftModal";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

export default function POS() {
  const { user } = useAuth();
  const { currentBranch, loading: branchLoading } = useBranch();
  const { items, addItem, removeItem, updateQuantity, clearCart, total, itemCount } = useCart();
  const { notifySaleCreated } = useSync();
  const {
    activeShift,
    shiftSalesTotal,
    loading: shiftLoading,
    openShift,
    closeShift,
  } = useCashShift();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todas");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [processing, setProcessing] = useState(false);
  const [offlineBannerDismissed, setOfflineBannerDismissed] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [shiftOpenModalOpen, setShiftOpenModalOpen] = useState(false);
  const [closeShiftModalOpen, setCloseShiftModalOpen] = useState(false);
  const lastSaleRef = useRef<Sale | null>(null);
  const { setOnBarcode, barcodeScanner } = usePeripherals();

  // Listen for barcode scanner input (keyboard wedge) — auto-populate search
  useEffect(() => {
    setOnBarcode((barcode: string) => {
      setSearch(barcode);
      // Switch to "Todas" so the barcode search covers all products
      setSelectedCategory("Todas");
      toast.success(`Código escaneado: ${barcode}`);
    });
    return () => setOnBarcode(null);
  }, [setOnBarcode]);

  const online = navigator.onLine;
  const businessId = user?.businessId ?? "";
  const branchId = currentBranch?.id ?? "";
  const shiftId = activeShift?.id ?? "";

  // Determine if we should show the open-shift modal
  const needsShift =
    !branchLoading &&
    !shiftLoading &&
    !!branchId &&
    !!user?.branchUserId &&
    !activeShift;

  // Dynamic categories from DB (distinct query key to avoid collision with Products page)
  const { data: categoryNames = [] } = useQuery({
    queryKey: ["categoryNames", businessId],
    queryFn: async () => {
      if (!businessId) return [];
      const cats = await db.categories.where("businessId").equals(businessId).toArray();
      return cats.map((c) => c.name);
    },
    enabled: !!businessId,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products", businessId, branchId],
    queryFn: async () => {
      if (!businessId || !branchId) return [];
      const all = await db.products.where("businessId").equals(businessId).toArray();
      return all.filter((p) => p.branchId === branchId);
    },
    enabled: !!businessId && !!branchId,
  });

  const filteredProducts = useMemo(() => {
    let result = products;
    if (selectedCategory !== "Todas") {
      result = result.filter((p) => p.category === selectedCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(q) || p.barcode.includes(q));
    }
    return result;
  }, [products, selectedCategory, search]);

  const saleMutation = useMutation({
    mutationFn: async () => {
      if (!businessId || !branchId) throw new Error("No business/branch selected");

      const saleItems = items.map((i) => ({
        productId: i.product.id,
        productName: i.product.name,
        quantity: i.quantity,
        unitPrice: i.product.price,
        subtotal: Math.round(i.product.price * i.quantity * 100) / 100,
      }));

      const roundedTotal = Math.round(total * 100) / 100;
      const paid = paymentMethod === "cash" ? Number(amountPaid) : roundedTotal;
      const change = paymentMethod === "cash" ? Math.round((paid - roundedTotal) * 100) / 100 : 0;

      const saleId = crypto.randomUUID();
      await db.sales.add({
        id: saleId,
        businessId,
        branchId,
        branchUserId: user?.branchUserId ?? "",
        shiftId,
        items: saleItems,
        total: roundedTotal,
        paymentMethod,
        amountPaid: paid,
        change,
        customerEmail: customerEmail.trim(),
        createdAt: Date.now(),
        synced: 0,
      });

      for (const item of items) {
        const product = await db.products.get(item.product.id);
        if (product) {
          await db.products.update(item.product.id, { stock: Math.max(0, product.stock - item.quantity) });
        }
      }

      // Return the sale object so onSuccess can use it
      return {
        id: saleId,
        businessId,
        branchId,
        branchUserId: user?.branchUserId ?? "",
        shiftId,
        items: saleItems,
        total: roundedTotal,
        paymentMethod,
        amountPaid: paid,
        change,
        customerEmail: customerEmail.trim(),
        createdAt: Date.now(),
        synced: 0,
      } as Sale;
    },
    onSuccess: (sale: Sale) => {
      lastSaleRef.current = sale;
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["cashShift"] });
      notifySaleCreated();
      setPaymentOpen(false);
      setAmountPaid("");
      setCustomerEmail("");
      setProcessing(false);
      setOfflineBannerDismissed(false);
      setSuccessOpen(true);
    },
    onError: () => {
      setProcessing(false);
      toast.error("Error al registrar la venta");
    },
  });

  const handlePayment = useCallback(() => {
    if (paymentMethod === "cash" && Number(amountPaid) < total) {
      toast.error("El monto recibido es menor al total");
      return;
    }
    setProcessing(true);
    saleMutation.mutate();
  }, [paymentMethod, amountPaid, total, saleMutation]);

  const change = paymentMethod === "cash" && amountPaid ? Math.round((Number(amountPaid) - total) * 100) / 100 : 0;

  const handleOpenShift = useCallback(
    async (initialCash: number) => {
      await openShift(initialCash);
      setShiftOpenModalOpen(false);
    },
    [openShift],
  );

  const handleCloseShift = useCallback(
    async (declaredCash: number) => {
      await closeShift(declaredCash);
      setCloseShiftModalOpen(false);
    },
    [closeShift],
  );

  // While shift state is loading, show a spinner
  if (branchLoading || shiftLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-slate-400">Cargando...</p>
      </div>
    );
  }

  if (!currentBranch) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Selecciona una sucursal para usar el POS.</p>
      </div>
    );
  }

  // No active shift — the POS is blocked until one is opened
  if (needsShift) {
    return (
      <>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
            <Clock className="h-10 w-10 text-amber-600" />
          </div>
          <div className="text-center max-w-sm">
            <h3 className="text-lg font-bold text-slate-800">No hay turno activo</h3>
            <p className="mt-1 text-sm text-slate-500">
              Debes abrir un turno de caja en <strong>{currentBranch.name}</strong> antes de poder realizar ventas.
            </p>
          </div>
          <Button
            className="bg-amber-500 px-8 py-5 text-base font-bold text-white hover:bg-amber-600"
            onClick={() => setShiftOpenModalOpen(true)}
          >
            Abrir Caja
          </Button>
        </div>

        <OpenShiftModal
          open={shiftOpenModalOpen}
          branchName={currentBranch.name}
          onOpenShift={handleOpenShift}
        />
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Punto de Venta</h2>
            <p className="text-sm text-slate-500">{currentBranch.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {!online && (
              <Badge variant="destructive" className="gap-1.5">
                <WifiOff className="h-3 w-3" />
                Modo Offline
              </Badge>
            )}
            {activeShift && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCloseShiftModalOpen(true)}
                className="gap-1.5 border-slate-200 text-slate-600 hover:border-red-200 hover:text-red-600 hover:bg-red-50 text-xs"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                Cerrar Caja
              </Button>
            )}
            <Badge variant="outline" className="gap-1.5 border-slate-200 px-3 py-1.5">
              <Barcode className="h-3.5 w-3.5" />
              Modo Venta Rápida
            </Badge>
          </div>
        </div>
      </div>

      {/* Offline info banner */}
      {!online && !offlineBannerDismissed && (
        <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-6 py-2.5">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>Estás trabajando sin conexión. Las ventas se guardan localmente y se sincronizarán al reconectar.</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setOfflineBannerDismissed(true)} className="h-7 text-amber-600 hover:text-amber-800 text-xs">
            Entendido
          </Button>
        </div>
      )}

      {/* Main POS Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Product Grid Section */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-slate-100 bg-white px-4 py-3">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input placeholder="Buscar por nombre o código de barras..." value={search} onChange={(e) => setSearch(e.target.value)} className="border-slate-200 bg-slate-50 pl-9 focus-visible:ring-amber-500" />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 flex-wrap">
              <Button variant="ghost" size="sm" onClick={() => setSelectedCategory("Todas")} className={cn("shrink-0 rounded-full px-3.5 text-xs font-medium transition-all", selectedCategory === "Todas" ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                Todas
              </Button>
              {categoryNames.map((cat) => (
                <Button key={cat} variant="ghost" size="sm" onClick={() => setSelectedCategory(cat)} className={cn("shrink-0 rounded-full px-3.5 text-xs font-medium transition-all", selectedCategory === cat ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                  {cat}
                </Button>
              ))}
            </div>
          </div>

          <ScrollArea className="flex-1 p-4">
            {filteredProducts.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center text-slate-400">
                <PackageOpen className="mb-2 h-10 w-10" />
                <p className="text-sm">No se encontraron productos</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {filteredProducts.map((product) => (
                  <ProductCard key={product.id} product={product} onAdd={() => addItem(product)} />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Cart Section */}
        <div className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white shadow-lg lg:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-slate-600" />
              <h3 className="font-semibold text-slate-900">Carrito</h3>
              {itemCount > 0 && <Badge className="bg-amber-500 hover:bg-amber-500">{itemCount}</Badge>}
            </div>
            {items.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearCart} className="h-8 text-xs text-slate-400 hover:text-red-500">
                <Trash2 className="mr-1 h-3.5 w-3.5" />Vaciar
              </Button>
            )}
          </div>

          <ScrollArea className="flex-1">
            {items.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center text-slate-300">
                <ShoppingCart className="mb-2 h-12 w-12" />
                <p className="text-sm">Carrito vacío</p>
                <p className="text-xs">Agrega productos del catálogo</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {items.map((item) => (
                  <div key={item.product.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{item.product.name}</p>
                      <p className="text-xs text-slate-500">{formatCurrency(item.product.price)} c/u</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-7 w-7 rounded-full border-slate-200" onClick={() => updateQuantity(item.product.id, item.quantity - 1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-7 text-center text-sm font-medium tabular-nums">{item.quantity}</span>
                      <Button variant="outline" size="icon" className="h-7 w-7 rounded-full border-slate-200" onClick={() => updateQuantity(item.product.id, item.quantity + 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="w-20 text-right text-sm font-semibold text-slate-900 tabular-nums">{formatCurrency(item.product.price * item.quantity)}</p>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-300 hover:text-red-500" onClick={() => removeItem(item.product.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="border-t border-slate-200 p-4">
            <div className="mb-4 space-y-1.5">
              <div className="flex justify-between text-sm text-slate-500">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatCurrency(total)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-bold text-slate-900">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(total)}</span>
              </div>
            </div>
            <Button className="w-full bg-amber-500 py-6 text-base font-bold text-white hover:bg-amber-600 active:scale-[0.98] transition-transform" disabled={items.length === 0} onClick={() => setPaymentOpen(true)}>
              Cobrar {formatCurrency(total)}
            </Button>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Cobrar Venta</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="rounded-xl bg-slate-50 p-4 text-center">
              <p className="text-sm text-slate-500">Total a pagar</p>
              <p className="text-3xl font-bold text-slate-900">{formatCurrency(total)}</p>
              <p className="mt-1 text-xs text-slate-400">{itemCount} artículo{itemCount !== 1 ? "s" : ""}</p>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Método de pago</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: "cash" as const, icon: Banknote, label: "Efectivo" },
                  { id: "card" as const, icon: CreditCard, label: "Tarjeta" },
                  { id: "transfer" as const, icon: ArrowRightLeft, label: "Transferencia" },
                ]).map((method) => (
                  <button key={method.id} onClick={() => setPaymentMethod(method.id)} className={cn("flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-all", paymentMethod === method.id ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600")}>
                    <method.icon className="h-6 w-6" />
                    <span className="text-xs font-medium">{method.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === "cash" && (
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Monto recibido</p>
                <div className="grid grid-cols-3 gap-2">
                  {[Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100].map((amount) => (
                    <Button key={amount} variant="outline" size="sm" onClick={() => setAmountPaid(String(amount))} className={cn("border-slate-200 font-mono text-sm", amountPaid === String(amount) && "border-amber-500 bg-amber-50 text-amber-700")}>
                      {formatCurrency(amount)}
                    </Button>
                  ))}
                </div>
                <Input type="number" placeholder="Otra cantidad..." value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} className="mt-2 border-slate-200" />
                {amountPaid && Number(amountPaid) >= total && (
                  <div className="mt-2 rounded-lg bg-emerald-50 p-3 text-center">
                    <p className="text-sm font-medium text-emerald-700">Cambio: {formatCurrency(change)}</p>
                  </div>
                )}
                {amountPaid && Number(amountPaid) < total && (
                  <p className="mt-2 text-center text-sm text-red-500">El monto es menor al total</p>
                )}
              </div>
            )}

            {/* Customer email (optional) */}
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <Mail className="h-4 w-4" />
                Correo del cliente <span className="text-xs font-normal text-slate-400">(opcional)</span>
              </p>
              <Input
                type="email"
                placeholder="cliente@correo.com"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="border-slate-200"
              />
            </div>

            {!online && (
              <div className="rounded-lg bg-amber-50 p-3 text-center">
                <p className="text-xs text-amber-700">La venta se guardará localmente y se sincronizará cuando recuperes conexión.</p>
              </div>
            )}

            <Button className="w-full bg-amber-500 py-6 text-base font-bold text-white hover:bg-amber-600" disabled={processing || (paymentMethod === "cash" && Number(amountPaid) < total)} onClick={handlePayment}>
              {processing ? "Procesando..." : `Confirmar ${paymentMethod === "cash" ? "Pago" : "Cobro"}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Success Modal */}
      {lastSaleRef.current && (
        <SaleSuccessModal
          open={successOpen}
          onClose={(didPrintOrSend) => {
            setSuccessOpen(false);
            if (didPrintOrSend) clearCart();
            lastSaleRef.current = null;
          }}
          sale={lastSaleRef.current}
          branch={currentBranch}
          branchUserName={user?.branchUserName ?? ""}
          businessEmail={user?.email ?? ""}
          receiptWidthMm={80}
        />
      )}

      {/* Close Shift Modal */}
      {activeShift && (
        <CloseShiftModal
          open={closeShiftModalOpen}
          initialCash={activeShift.initialCash}
          shiftSalesTotal={shiftSalesTotal}
          onCloseShift={handleCloseShift}
        />
      )}
    </div>
  );
}

function ProductCard({ product, onAdd }: { product: Product; onAdd: () => void }) {
  const isLowStock = product.stock <= 5;
  return (
    <Card onClick={onAdd} className={cn("group cursor-pointer border-slate-200 p-3 transition-all hover:border-amber-300 hover:shadow-md active:scale-[0.97]", isLowStock && "border-red-200 bg-red-50/30")}>
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-1">
          <p className="line-clamp-2 text-sm font-medium leading-tight text-slate-800 group-hover:text-slate-900">{product.name}</p>
          {isLowStock && <Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-[10px]">Bajo</Badge>}
        </div>
        <p className="text-lg font-bold text-amber-600">{formatCurrency(product.price)}</p>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-400">{product.category}</span>
          <span className={cn("text-[11px]", isLowStock ? "font-medium text-red-500" : "text-slate-400")}>Stock: {product.stock}</span>
        </div>
      </div>
    </Card>
  );
}
