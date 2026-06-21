import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  collection as fsCollection,
  type Firestore,
} from "firebase/firestore";
import { useQueryClient } from "@tanstack/react-query";
import { getDB, isFirebaseEnabled, firebasePromise } from "@/lib/firebase";
import {
  db,
  type Sale,
  type Branch,
  type BranchUser,
  type BusinessCategory,
  type Product,
  type CashShift,
  type InventoryMovement,
} from "@/db/database";
import { useAuth } from "@/contexts/AuthContext";

// ───── Tombstone set (prevents resurrection of locally-deleted items) ─────
const deletedIds = new Map<string, Set<string>>();
const TOMBSTONE_TTL = 5 * 60 * 1000; // 5 minutes

function addDeletedId(collection: string, docId: string): void {
  let set = deletedIds.get(collection);
  if (!set) {
    set = new Set();
    deletedIds.set(collection, set);
  }
  set.add(docId);
  setTimeout(() => {
    const s = deletedIds.get(collection);
    if (s) {
      s.delete(docId);
      if (s.size === 0) deletedIds.delete(collection);
    }
  }, TOMBSTONE_TTL);
}

function isDeletedId(collection: string, docId: string): boolean {
  return deletedIds.get(collection)?.has(docId) ?? false;
}

// ───── Context value type ─────
interface SyncContextValue {
  syncPendingCount: number;
  notifySaleCreated: () => void;
  syncNow: () => Promise<void>;
  syncing: boolean;
  lastSyncAt: number | null;
  firestorePath: string;
  firebaseConnected: boolean;
  lastSyncResult: { pushed: number; pulled: number; error?: string } | null;

  pushBranch: (branch: Branch) => void;
  pushBranchUser: (bu: BranchUser) => void;
  pushCategory: (cat: BusinessCategory) => void;
  pushProduct: (product: Product) => void;
  pushCashShift: (shift: CashShift) => void;
  pushInventoryMovement: (mov: InventoryMovement) => void;
  deleteFromFirestore: (collection: string, docId: string) => void;
  deleteFromFirestoreAsync: (collection: string, docId: string) => Promise<void>;
  deleteMultipleFromFirestore: (collection: string, ids: string[]) => void;
  pullAllFromCloud: () => Promise<number>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

// ───── Helpers ─────
function fireAndForget(promise: Promise<unknown>, label: string) {
  promise
    .then(() => { console.log(`[Sync] ✅ ${label} — ok`); })
    .catch((err) => {
      const msg = err?.message ?? String(err);
      console.error(`[Sync] ❌ ${label} — FAILED:`, msg);
      if (err && typeof err === "object" && "code" in err) {
        console.error(`[Sync]    code: ${(err as { code: string }).code}`);
      }
    });
}

// ───── Provider ─────
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
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

  // ───── Fire-and-forget pushers (individual docs → Firestore) ─────

  const pushDoc = useCallback(
    (collection: string, docId: string, data: Record<string, unknown>) => {
      if (!isFirebaseEnabled || !navigator.onLine || !businessId) return;
      const firestore = getDB();
      if (!firestore) return;
      fireAndForget(
        setDoc(doc(firestore, "businesses", businessId, collection, docId), data),
        `push ${collection}/${docId}`,
      );
    },
    [businessId],
  );

  const deleteFromCloud = useCallback(
    (collection: string, docId: string) => {
      addDeletedId(collection, docId);
      if (!isFirebaseEnabled || !navigator.onLine || !businessId) return;
      const firestore = getDB();
      if (!firestore) return;
      fireAndForget(
        deleteDoc(doc(firestore, "businesses", businessId, collection, docId)),
        `delete ${collection}/${docId}`,
      );
    },
    [businessId],
  );

  const deleteFromCloudAsync = useCallback(
    async (collection: string, docId: string): Promise<void> => {
      if (!isFirebaseEnabled || !navigator.onLine || !businessId) return;
      const firestore = getDB();
      if (!firestore) return;
      await deleteDoc(doc(firestore, "businesses", businessId, collection, docId));
    },
    [businessId],
  );

  const deleteMultipleFromCloud = useCallback(
    async (collection: string, ids: string[]) => {
      if (!isFirebaseEnabled || !navigator.onLine || !businessId || ids.length === 0) return;
      const firestore = getDB();
      if (!firestore) return;
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const batch = writeBatch(firestore);
        for (const docId of chunk) {
          batch.delete(doc(firestore, "businesses", businessId, collection, docId));
        }
        fireAndForget(batch.commit(), `batch delete ${collection} (${chunk.length} docs)`);
      }
    },
    [businessId],
  );

  const pushBranch = useCallback(
    (branch: Branch) => pushDoc("branches", branch.id, branch as unknown as Record<string, unknown>),
    [pushDoc],
  );
  const pushBranchUser = useCallback(
    (bu: BranchUser) => pushDoc("branchUsers", bu.id, bu as unknown as Record<string, unknown>),
    [pushDoc],
  );
  const pushCategory = useCallback(
    (cat: BusinessCategory) => pushDoc("categories", cat.id, cat as unknown as Record<string, unknown>),
    [pushDoc],
  );
  const pushProduct = useCallback(
    (product: Product) => pushDoc("products", product.id, product as unknown as Record<string, unknown>),
    [pushDoc],
  );
  const pushCashShift = useCallback(
    (shift: CashShift) => pushDoc("cash_shifts", shift.id, shift as unknown as Record<string, unknown>),
    [pushDoc],
  );
  const pushInventoryMovement = useCallback(
    (mov: InventoryMovement) => pushDoc("inventory_movements", mov.id, mov as unknown as Record<string, unknown>),
    [pushDoc],
  );

  const deleteFromFirestore = useCallback(
    (collection: string, docId: string) => deleteFromCloud(collection, docId),
    [deleteFromCloud],
  );

  const deleteFromFirestoreAsync = useCallback(
    (collection: string, docId: string) => deleteFromCloudAsync(collection, docId),
    [deleteFromCloudAsync],
  );

  const deleteMultipleFromFirestore = useCallback(
    (collection: string, ids: string[]) => { deleteMultipleFromCloud(collection, ids); },
    [deleteMultipleFromCloud],
  );

  // ───── Batch sales pusher ─────

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
        for (const id of ids) {
          await db.sales.update(id, { synced: 1 } as Partial<Sale>);
        }
        synced += chunk.length;
      }
      return synced;
    },
    [businessId],
  );

  // ───── Legacy one-time pull (fallback — not used in automatic sync) ─────

  const pullCollection = useCallback(
    async <T extends { id: string }>(
      collectionName: string,
      table: { bulkPut(items: T[]): Promise<string>; bulkDelete(ids: string[]): Promise<void> },
      mapDoc: (id: string, data: Record<string, unknown>) => T,
    ): Promise<number> => {
      if (!isFirebaseEnabled || !navigator.onLine) return 0;
      const firestore = getDB();
      if (!firestore) return 0;
      const { getDocs, collection } = await import("firebase/firestore");
      const snapshot = await getDocs(collection(firestore, "businesses", businessId, collectionName));
      const toPut: T[] = [];
      for (const docSnap of snapshot.docs) {
        const docId = docSnap.id;
        if (isDeletedId(collectionName, docId)) continue;
        const data = docSnap.data() as Record<string, unknown>;
        toPut.push(mapDoc(docId, data));
      }
      if (toPut.length > 0) await table.bulkPut(toPut);
      return toPut.length;
    },
    [businessId],
  );

  const pullAllFromCloud = useCallback(async (): Promise<number> => {
    if (!businessId || !isFirebaseEnabled || !navigator.onLine) return 0;
    let total = 0;

    total += await pullCollection("branches", db.branches, (id, data) => ({
      id, businessId, name: (data.name as string) ?? "", address: (data.address as string) ?? "",
      phone: (data.phone as string) ?? "", createdAt: (data.createdAt as number) ?? Date.now(),
    }));
    total += await pullCollection("branchUsers", db.branchUsers, (id, data) => ({
      id, businessId, branchId: (data.branchId as string) ?? "", name: (data.name as string) ?? "",
      pin: (data.pin as string) ?? "", role: (data.role as "admin" | "cajero") ?? "cajero",
      isOwner: (data.isOwner as boolean) ?? false,
      accessibleBranchIds: (data.accessibleBranchIds as string[]) ?? [],
      createdAt: (data.createdAt as number) ?? Date.now(),
    }));
    total += await pullCollection("categories", db.categories, (id, data) => ({
      id, businessId, name: (data.name as string) ?? "", createdAt: (data.createdAt as number) ?? Date.now(),
    }));
    total += await pullCollection("products", db.products, (id, data) => ({
      id, businessId, branchId: (data.branchId as string) ?? "", name: (data.name as string) ?? "",
      price: (data.price as number) ?? 0, cost: (data.cost as number) ?? 0,
      barcode: (data.barcode as string) ?? "", category: (data.category as string) ?? "",
      stock: (data.stock as number) ?? 0, imageUrl: (data.imageUrl as string) ?? "",
      createdAt: (data.createdAt as number) ?? Date.now(),
    }));
    total += await pullCollection("cash_shifts", db.cashShifts, (id, data) => ({
      id, businessId, branchId: (data.branchId as string) ?? "", branchUserId: (data.branchUserId as string) ?? "",
      initialCash: (data.initialCash as number) ?? 0, totalSales: (data.totalSales as number) ?? 0,
      declaredCash: (data.declaredCash as number) ?? 0, difference: (data.difference as number) ?? 0,
      status: (data.status as "open" | "closed") ?? "closed",
      openedAt: (data.openedAt as number) ?? 0, closedAt: (data.closedAt as number) ?? 0, synced: 1,
    }));
    total += await pullCollection("inventory_movements", db.inventoryMovements, (id, data) => ({
      id, businessId, sourceBranchId: (data.sourceBranchId as string) ?? "",
      sourceBranchName: (data.sourceBranchName as string) ?? "",
      destBranchId: (data.destBranchId as string) ?? "",
      destBranchName: (data.destBranchName as string) ?? "",
      productId: (data.productId as string) ?? "", productName: (data.productName as string) ?? "",
      quantity: (data.quantity as number) ?? 0, transferredBy: (data.transferredBy as string) ?? "",
      transferredByName: (data.transferredByName as string) ?? "",
      createdAt: (data.createdAt as number) ?? Date.now(),
    }));

    console.log(`[Sync] (pullAllFromCloud) Pulled ${total} documents from Firestore`);
    return total;
  }, [businessId, pullCollection]);

  // ═══════════════════════════════════════════════════════════════
  //  REAL-TIME LISTENERS (onSnapshot) — replaces periodic pull
  // ═══════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!businessId || !isFirebaseEnabled) return;

    const firestore = getDB();
    if (!firestore) return;

    console.log(`[Sync] 🔌 Starting onSnapshot listeners for business: ${businessId}`);

    type DexieTable = { bulkPut(items: unknown[]): Promise<unknown>; bulkDelete(ids: unknown[]): Promise<unknown> };

    const collectionsToWatch = [
      {
        name: "branches",
        table: db.branches as unknown as DexieTable,
        queryKeys: [["branches"]],
        mapDoc: (id: string, data: Record<string, unknown>) => ({
          id, businessId,
          name: (data.name as string) ?? "",
          address: (data.address as string) ?? "",
          phone: (data.phone as string) ?? "",
          createdAt: (data.createdAt as number) ?? Date.now(),
        } as unknown as Record<string, unknown>),
      },
      {
        name: "branchUsers",
        table: db.branchUsers as unknown as DexieTable,
        queryKeys: [["branchUsers"]],
        mapDoc: (id: string, data: Record<string, unknown>) => ({
          id, businessId,
          branchId: (data.branchId as string) ?? "",
          name: (data.name as string) ?? "",
          pin: (data.pin as string) ?? "",
          role: (data.role as "admin" | "cajero") ?? "cajero",
          isOwner: (data.isOwner as boolean) ?? false,
          accessibleBranchIds: (data.accessibleBranchIds as string[]) ?? [],
          createdAt: (data.createdAt as number) ?? Date.now(),
        } as unknown as Record<string, unknown>),
      },
      {
        name: "categories",
        table: db.categories as unknown as DexieTable,
        queryKeys: [["categories"], ["products"]],
        mapDoc: (id: string, data: Record<string, unknown>) => ({
          id, businessId,
          name: (data.name as string) ?? "",
          createdAt: (data.createdAt as number) ?? Date.now(),
        } as unknown as Record<string, unknown>),
      },
      {
        name: "products",
        table: db.products as unknown as DexieTable,
        queryKeys: [["products"]],
        mapDoc: (id: string, data: Record<string, unknown>) => ({
          id, businessId,
          branchId: (data.branchId as string) ?? "",
          name: (data.name as string) ?? "",
          price: (data.price as number) ?? 0,
          cost: (data.cost as number) ?? 0,
          barcode: (data.barcode as string) ?? "",
          category: (data.category as string) ?? "",
          stock: (data.stock as number) ?? 0,
          imageUrl: (data.imageUrl as string) ?? "",
          createdAt: (data.createdAt as number) ?? Date.now(),
        } as unknown as Record<string, unknown>),
      },
      {
        name: "cash_shifts",
        table: db.cashShifts as unknown as DexieTable,
        queryKeys: [["cashShifts"]],
        mapDoc: (id: string, data: Record<string, unknown>) => ({
          id, businessId,
          branchId: (data.branchId as string) ?? "",
          branchUserId: (data.branchUserId as string) ?? "",
          initialCash: (data.initialCash as number) ?? 0,
          totalSales: (data.totalSales as number) ?? 0,
          declaredCash: (data.declaredCash as number) ?? 0,
          difference: (data.difference as number) ?? 0,
          status: (data.status as "open" | "closed") ?? "closed",
          openedAt: (data.openedAt as number) ?? 0,
          closedAt: (data.closedAt as number) ?? 0,
          synced: 1,
        } as unknown as Record<string, unknown>),
      },
      {
        name: "inventory_movements",
        table: db.inventoryMovements as unknown as DexieTable,
        queryKeys: [["inventoryMovements"]],
        mapDoc: (id: string, data: Record<string, unknown>) => ({
          id, businessId,
          sourceBranchId: (data.sourceBranchId as string) ?? "",
          sourceBranchName: (data.sourceBranchName as string) ?? "",
          destBranchId: (data.destBranchId as string) ?? "",
          destBranchName: (data.destBranchName as string) ?? "",
          productId: (data.productId as string) ?? "",
          productName: (data.productName as string) ?? "",
          quantity: (data.quantity as number) ?? 0,
          transferredBy: (data.transferredBy as string) ?? "",
          transferredByName: (data.transferredByName as string) ?? "",
          createdAt: (data.createdAt as number) ?? Date.now(),
        } as unknown as Record<string, unknown>),
      },
    ];

    const unsubscribers: (() => void)[] = [];

    for (const col of collectionsToWatch) {
      const ref = fsCollection(firestore, "businesses", businessId, col.name);

      const unsub = onSnapshot(
        ref,
        { includeMetadataChanges: false },
        (snapshot) => {
          const toPut: Record<string, unknown>[] = [];
          const toDelete: string[] = [];
          let hasChanges = false;

          for (const change of snapshot.docChanges()) {
            const docId = change.doc.id;

            if (change.type === "removed") {
              toDelete.push(docId);
              // Clear tombstone if one existed — Firestore confirmed the deletion
              deletedIds.get(col.name)?.delete(docId);
              hasChanges = true;
            } else {
              // added or modified — skip tombstoned items (locally deleted, not yet confirmed)
              if (isDeletedId(col.name, docId)) continue;
              toPut.push(col.mapDoc(docId, change.doc.data() as Record<string, unknown>));
              hasChanges = true;
            }
          }

          // Apply to Dexie
          if (toPut.length > 0) {
            col.table.bulkPut(toPut).catch((err: unknown) =>
              console.error(`[Sync] bulkPut ${col.name}:`, err),
            );
          }
          if (toDelete.length > 0) {
            col.table.bulkDelete(toDelete).catch((err: unknown) =>
              console.error(`[Sync] bulkDelete ${col.name}:`, err),
            );
          }

          // Invalidate React Query so UI refreshes from Dexie
          if (hasChanges) {
            for (const qk of col.queryKeys) {
              queryClient.invalidateQueries({ queryKey: qk });
            }
          }
        },
        (error: Error) => {
          console.error(`[Sync] ❌ onSnapshot error for "${col.name}":`, error.message);
        },
      );

      unsubscribers.push(unsub);
    }

    // Cleanup: unsubscribe all when businessId changes or component unmounts
    return () => {
      console.log(`[Sync] 🔌 Stopping onSnapshot listeners for business: ${businessId}`);
      for (const unsub of unsubscribers) unsub();
    };
  }, [businessId, queryClient]);

  // ───── Main sync orchestrator (sales push only — real-time pull via onSnapshot) ─────

  const syncNow = useCallback(async () => {
    if (syncInProgress.current || !businessId || !user) return;
    syncInProgress.current = true;
    setSyncing(true);
    try {
      const allSales = await db.sales.where("businessId").equals(businessId).toArray();
      const unsyncedSales = allSales.filter((s) => s.synced === 0);

      if (!isFirebaseEnabled) {
        if (unsyncedSales.length > 0) {
          for (const sale of unsyncedSales) {
            await db.sales.update(sale.id, { synced: 1 } as Partial<Sale>);
          }
        }
        setLastSyncResult({ pushed: unsyncedSales.length, pulled: 0 });
      } else {
        const firestore = getDB();
        if (!firestore) throw new Error("Firestore not initialised");

        let pushed = 0;
        if (unsyncedSales.length > 0) {
          pushed = await pushSalesToFirestore(firestore, unsyncedSales);
        }
        console.log(`[Sync] ✅ Pushed ${pushed} sales`);
        setLastSyncResult({ pushed, pulled: 0 });
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
  }, [businessId, user, countPending, pushSalesToFirestore]);

  const notifySaleCreated = useCallback(() => {
    countPending();
    if (navigator.onLine) syncNow();
  }, [countPending, syncNow]);

  // Initial count on mount
  useEffect(() => {
    firebasePromise.then(() => { countPending(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  // Auto-sync on reconnect (sales push only — listeners re-connect on their own)
  useEffect(() => {
    const handleOnline = () => { syncNow(); };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [syncNow]);

  // Periodic sales push (no pull — listeners handle real-time updates)
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!navigator.onLine || !businessId || !user) return;
      if (isFirebaseEnabled) {
        const firestore = getDB();
        if (!firestore) return;
        try {
          const allSales = await db.sales.where("businessId").equals(businessId).toArray();
          const unsynced = allSales.filter((s) => s.synced === 0);
          if (unsynced.length > 0) {
            await pushSalesToFirestore(firestore, unsynced);
          }
        } catch { /* offline — no worries */ }
      } else {
        const allSales = await db.sales.where("businessId").equals(businessId).toArray();
        for (const s of allSales) {
          if (s.synced === 0) await db.sales.update(s.id, { synced: 1 } as Partial<Sale>);
        }
      }
      await countPending();
    }, 30_000);
    return () => clearInterval(interval);
  }, [businessId, user, countPending, pushSalesToFirestore]);

  // Re-count when businessId or user changes
  useEffect(() => { if (user) countPending(); }, [businessId, user, countPending]);

  const firestorePath = businessId ? `businesses/${businessId}` : "";
  const firebaseConnected = isFirebaseEnabled && navigator.onLine;

  const value = useMemo<SyncContextValue>(
    () => ({
      syncPendingCount, notifySaleCreated, syncNow, syncing, lastSyncAt,
      firestorePath, firebaseConnected, lastSyncResult,
      pushBranch, pushBranchUser, pushCategory, pushProduct,
      pushCashShift, pushInventoryMovement,
      deleteFromFirestore, deleteFromFirestoreAsync, deleteMultipleFromFirestore,
      pullAllFromCloud,
    }),
    [
      syncPendingCount, notifySaleCreated, syncNow, syncing, lastSyncAt,
      firestorePath, firebaseConnected, lastSyncResult,
      pushBranch, pushBranchUser, pushCategory, pushProduct,
      pushCashShift, pushInventoryMovement,
      deleteFromFirestore, deleteFromFirestoreAsync, deleteMultipleFromFirestore,
      pullAllFromCloud,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
