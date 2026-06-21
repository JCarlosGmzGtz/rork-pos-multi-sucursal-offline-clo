import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { doc, setDoc, writeBatch, type Firestore } from "firebase/firestore";
import { getDB, isFirebaseEnabled, firebasePromise } from "@/lib/firebase";
import { db, type Sale } from "@/db/database";
import { useAuth } from "@/contexts/AuthContext";

interface SyncContextValue {
  syncPendingCount: number;
  notifySaleCreated: () => void;
  syncNow: () => Promise<void>;
  syncing: boolean;
  lastSyncAt: number | null;
  firestorePath: string;
  firebaseConnected: boolean;
  lastSyncResult: { pushed: number; pulled: number; error?: string } | null;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [syncPendingCount, setSyncPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<{ pushed: number; pulled: number; error?: string } | null>(null);
  const syncInProgress = useRef(false);

  const businessId = user?.businessId || "";

  const countPending = useCallback(async () => {
    if (!businessId || !user) return;
    const all = await db.sales.where("businessId").equals(businessId).toArray();
    const count = all.filter((s) => s.synced === 0).length;
    setSyncPendingCount(count);
  }, [businessId, user]);

  const pushSalesToFirestore = useCallback(
    async (firestore: Firestore, sales: Sale[]): Promise<number> => {
      let synced = 0;
      for (let i = 0; i < sales.length; i += 500) {
        const chunk = sales.slice(i, i + 500);
        const batch = writeBatch(firestore);
        const ids: string[] = [];
        for (const sale of chunk) {
          const ref = doc(firestore, "businesses", businessId, "sales", sale.id);
          const { synced: _synced, ...saleData } = sale as Sale & { synced?: number };
          batch.set(ref, saleData);
          ids.push(sale.id);
        }
        await batch.commit();
        console.log(`[Sync] Batch committed: ${chunk.length} sales → businesses/${businessId}/sales`);
        for (const id of ids) {
          await db.sales.update(id, { synced: 1 } as Partial<Sale>);
        }
        synced += chunk.length;
      }
      return synced;
    },
    [businessId],
  );

  const pullProductsFromFirestore = useCallback(
    async (firestore: Firestore): Promise<void> => {
      const { getDocs, collection } = await import("firebase/firestore");
      const snapshot = await getDocs(collection(firestore, "businesses", businessId, "products"));
      const existingIds = new Set((await db.products.toCollection().primaryKeys()) as string[]);
      let imported = 0;
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const product = {
          id: docSnap.id,
          businessId,
          name: data.name ?? "",
          price: data.price ?? 0,
          cost: data.cost ?? 0,
          barcode: data.barcode ?? "",
          category: data.category ?? "",
          stock: data.stock ?? 0,
          branchId: data.branchId ?? "",
          imageUrl: data.imageUrl ?? "",
          createdAt: data.createdAt ?? Date.now(),
        };
        if (existingIds.has(product.id)) {
          await db.products.update(product.id, product);
        } else {
          await db.products.put(product);
        }
        imported++;
      }
      console.log(`[Sync] Pulled ${imported} products from businesses/${businessId}/products`);
    },
    [businessId],
  );

  const syncNow = useCallback(async () => {
    if (syncInProgress.current || !businessId || !user) return;
    syncInProgress.current = true;
    setSyncing(true);
    try {
      const allSales = await db.sales.where("businessId").equals(businessId).toArray();
      const unsyncedSales = allSales.filter((s) => s.synced === 0);

      if (unsyncedSales.length === 0) {
        console.log(`[Sync] No pending sales — everything up to date.`);
        await countPending();
        setLastSyncAt(Date.now());
        setLastSyncResult({ pushed: 0, pulled: 0 });
        return;
      }

      if (!isFirebaseEnabled) {
        for (const sale of unsyncedSales) {
          await db.sales.update(sale.id, { synced: 1 } as Partial<Sale>);
        }
        console.log(`[Sync] Demo mode: marked ${unsyncedSales.length} sales as synced locally.`);
      } else {
        const firestore = getDB();
        if (!firestore) throw new Error("Firestore not initialised");
        await pullProductsFromFirestore(firestore);
        const synced = await pushSalesToFirestore(firestore, unsyncedSales);
        console.log(`[Sync] ✅ Pushed ${synced} sales → Firestore (businesses/${businessId}/sales)`);
        setLastSyncResult({ pushed: synced, pulled: 0 });
      }
    } catch (err) {
      console.error("[Sync] ❌ Sync failed:", err);
      setLastSyncResult({ pushed: 0, pulled: 0, error: String(err) });
    } finally {
      await countPending();
      setLastSyncAt(Date.now());
      setSyncing(false);
      syncInProgress.current = false;
    }
  }, [businessId, user, countPending, pullProductsFromFirestore, pushSalesToFirestore]);

  const notifySaleCreated = useCallback(() => {
    countPending();
    if (navigator.onLine) syncNow();
  }, [countPending, syncNow]);

  // Initial count + pull products
  useEffect(() => {
    firebasePromise.then(async () => {
      await countPending();
      if (isFirebaseEnabled && navigator.onLine) {
        const firestore = getDB();
        if (firestore) {
          try { await pullProductsFromFirestore(firestore); } catch { /* offline */ }
        }
      }
    });
  }, [countPending, pullProductsFromFirestore]);

  // Auto-sync on reconnect
  useEffect(() => {
    const handleOnline = () => { syncNow(); };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [syncNow]);

  // Periodic sync every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine && syncPendingCount > 0) syncNow();
    }, 30_000);
    return () => clearInterval(interval);
  }, [syncNow, syncPendingCount]);

  // Re-count when businessId or user changes
  useEffect(() => { if (user) countPending(); }, [businessId, user, countPending]);

  const firestorePath = businessId ? `businesses/${businessId}/sales` : "";
  const firebaseConnected = isFirebaseEnabled && navigator.onLine;

  const value = useMemo<SyncContextValue>(
    () => ({ syncPendingCount, notifySaleCreated, syncNow, syncing, lastSyncAt, firestorePath, firebaseConnected, lastSyncResult }),
    [syncPendingCount, notifySaleCreated, syncNow, syncing, lastSyncAt, firestorePath, firebaseConnected, lastSyncResult],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
