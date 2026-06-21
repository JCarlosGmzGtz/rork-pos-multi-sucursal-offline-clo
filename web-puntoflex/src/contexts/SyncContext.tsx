import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { doc, setDoc, deleteDoc, writeBatch, type Firestore } from "firebase/firestore";
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

/** Recently deleted doc IDs, keyed by collection name. Prevents pullAllFromCloud
 *  from resurrecting items whose Firestore delete hasn't completed yet. */
const deletedIds = new Map<string, Set<string>>();

/** Tombstone expiry: remove entries older than this (ms). */
const TOMBSTONE_TTL = 5 * 60 * 1000; // 5 minutes

function addDeletedId(collection: string, docId: string): void {
  let set = deletedIds.get(collection);
  if (!set) {
    set = new Set();
    deletedIds.set(collection, set);
  }
  set.add(docId);
  // Auto-clean this entry after TTL
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

interface SyncContextValue {
  syncPendingCount: number;
  notifySaleCreated: () => void;
  /** Trigger a full bidirectional sync (pull all + push sales). */
  syncNow: () => Promise<void>;
  syncing: boolean;
  lastSyncAt: number | null;
  firestorePath: string;
  firebaseConnected: boolean;
  lastSyncResult: { pushed: number; pulled: number; error?: string } | null;

  /** Fire-and-forget push of a single branch to Firestore. */
  pushBranch: (branch: Branch) => void;
  /** Fire-and-forget push of a single branch user to Firestore. */
  pushBranchUser: (bu: BranchUser) => void;
  /** Fire-and-forget push of a single category to Firestore. */
  pushCategory: (cat: BusinessCategory) => void;
  /** Fire-and-forget push of a single product to Firestore. */
  pushProduct: (product: Product) => void;
  /** Fire-and-forget push of a single cash shift to Firestore. */
  pushCashShift: (shift: CashShift) => void;
  /** Fire-and-forget push of a single inventory movement to Firestore. */
  pushInventoryMovement: (mov: InventoryMovement) => void;
  /** Delete a document from Firestore (fire-and-forget — used for cleanup where consistency is not critical). */
  deleteFromFirestore: (collection: string, docId: string) => void;
  /** Delete a document from Firestore and await completion (used when the caller needs to guarantee the delete before a subsequent pull). */
  deleteFromFirestoreAsync: (collection: string, docId: string) => Promise<void>;
  /** Batch-delete multiple documents from a Firestore subcollection. */
  deleteMultipleFromFirestore: (collection: string, ids: string[]) => void;
  /** Pull all data from Firestore into local Dexie. */
  pullAllFromCloud: () => Promise<number>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/** Non-blocking setDoc — returns void, logs errors prominently. */
function fireAndForget(promise: Promise<unknown>, label: string) {
  promise
    .then(() => {
      console.log(`[Sync] ✅ ${label} — ok`);
    })
    .catch((err) => {
      const msg = err?.message ?? String(err);
      console.error(`[Sync] ❌ ${label} — FAILED:`, msg);
      // Also log Firestore error code if available
      if (err && typeof err === "object" && "code" in err) {
        console.error(`[Sync]    code: ${(err as { code: string }).code}`);
      }
    });
}

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

  // ───── Fire-and-forget pushers (individual docs) ─────

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
      // Register tombstone BEFORE attempting Firestore delete
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

  /** Awaitable version — the caller blocks until the Firestore delete succeeds or fails. */
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
    (collection: string, ids: string[]) => {
      deleteMultipleFromCloud(collection, ids);
    },
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

  // ───── Pull all collections from Firestore ─────

  const pullCollection = useCallback(
    async <T extends { id: string }>(
      collectionName: string,
      table: { get(id: string): Promise<T | undefined>; put(item: T): Promise<string>; update(id: string, changes: Partial<T>): Promise<number>; toCollection(): { primaryKeys(): Promise<string[]> } },
      mapDoc: (id: string, data: Record<string, unknown>) => T,
    ): Promise<number> => {
      if (!isFirebaseEnabled || !navigator.onLine) return 0;
      const firestore = getDB();
      if (!firestore) return 0;
      const { getDocs, collection } = await import("firebase/firestore");
      const snapshot = await getDocs(collection(firestore, "businesses", businessId, collectionName));
      const existingIds = new Set(await table.toCollection().primaryKeys());
      let imported = 0;
      let skippedTombstones = 0;
      for (const docSnap of snapshot.docs) {
        const docId = docSnap.id;
        // Skip items that were recently deleted locally (tombstone)
        if (isDeletedId(collectionName, docId)) {
          skippedTombstones++;
          continue;
        }
        const data = docSnap.data() as Record<string, unknown>;
        const item = mapDoc(docId, data);
        if (existingIds.has(item.id)) {
          await table.update(item.id, item as Partial<T>);
        } else {
          await table.put(item);
        }
        imported++;
      }
      if (skippedTombstones > 0) {
        console.log(`[Sync] Pull ${collectionName}: skipped ${skippedTombstones} tombstoned docs`);
      }
      return imported;
    },
    [businessId],
  );

  const pullAllFromCloud = useCallback(async (): Promise<number> => {
    if (!businessId || !isFirebaseEnabled || !navigator.onLine) return 0;
    let total = 0;

    total += await pullCollection("branches", db.branches as unknown as { get(id: string): Promise<Branch | undefined>; put(item: Branch): Promise<string>; update(id: string, changes: Partial<Branch>): Promise<number>; toCollection(): { primaryKeys(): Promise<string[]> } }, (id, data) => ({
      id,
      businessId,
      name: (data.name as string) ?? "",
      address: (data.address as string) ?? "",
      phone: (data.phone as string) ?? "",
      createdAt: (data.createdAt as number) ?? Date.now(),
    }));

    total += await pullCollection("branchUsers", db.branchUsers as unknown as { get(id: string): Promise<BranchUser | undefined>; put(item: BranchUser): Promise<string>; update(id: string, changes: Partial<BranchUser>): Promise<number>; toCollection(): { primaryKeys(): Promise<string[]> } }, (id, data) => ({
      id,
      businessId,
      branchId: (data.branchId as string) ?? "",
      name: (data.name as string) ?? "",
      pin: (data.pin as string) ?? "",
      role: (data.role as "admin" | "cajero") ?? "cajero",
      isOwner: (data.isOwner as boolean) ?? false,
      accessibleBranchIds: (data.accessibleBranchIds as string[]) ?? [],
      createdAt: (data.createdAt as number) ?? Date.now(),
    }));

    total += await pullCollection("categories", db.categories as unknown as { get(id: string): Promise<BusinessCategory | undefined>; put(item: BusinessCategory): Promise<string>; update(id: string, changes: Partial<BusinessCategory>): Promise<number>; toCollection(): { primaryKeys(): Promise<string[]> } }, (id, data) => ({
      id,
      businessId,
      name: (data.name as string) ?? "",
      createdAt: (data.createdAt as number) ?? Date.now(),
    }));

    total += await pullCollection("products", db.products as unknown as { get(id: string): Promise<Product | undefined>; put(item: Product): Promise<string>; update(id: string, changes: Partial<Product>): Promise<number>; toCollection(): { primaryKeys(): Promise<string[]> } }, (id, data) => ({
      id,
      businessId,
      branchId: (data.branchId as string) ?? "",
      name: (data.name as string) ?? "",
      price: (data.price as number) ?? 0,
      cost: (data.cost as number) ?? 0,
      barcode: (data.barcode as string) ?? "",
      category: (data.category as string) ?? "",
      stock: (data.stock as number) ?? 0,
      imageUrl: (data.imageUrl as string) ?? "",
      createdAt: (data.createdAt as number) ?? Date.now(),
    }));

    total += await pullCollection("cash_shifts", db.cashShifts as unknown as { get(id: string): Promise<CashShift | undefined>; put(item: CashShift): Promise<string>; update(id: string, changes: Partial<CashShift>): Promise<number>; toCollection(): { primaryKeys(): Promise<string[]> } }, (id, data) => ({
      id,
      businessId,
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
    }));

    total += await pullCollection("inventory_movements", db.inventoryMovements as unknown as { get(id: string): Promise<InventoryMovement | undefined>; put(item: InventoryMovement): Promise<string>; update(id: string, changes: Partial<InventoryMovement>): Promise<number>; toCollection(): { primaryKeys(): Promise<string[]> } }, (id, data) => ({
      id,
      businessId,
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
    }));

    console.log(`[Sync] Pulled ${total} documents total from all Firestore collections`);
    return total;
  }, [businessId, pullCollection]);

  // ───── Main sync orchestrator ─────

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

        // Pull all data from cloud first, then push pending sales
        const pulled = await pullAllFromCloud();
        let pushed = 0;
        if (unsyncedSales.length > 0) {
          pushed = await pushSalesToFirestore(firestore, unsyncedSales);
        }
        console.log(`[Sync] ✅ Pulled ${pulled} docs · Pushed ${pushed} sales`);
        setLastSyncResult({ pushed, pulled });
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
  }, [businessId, user, countPending, pullAllFromCloud, pushSalesToFirestore]);

  const notifySaleCreated = useCallback(() => {
    countPending();
    if (navigator.onLine) syncNow();
  }, [countPending, syncNow]);

  // Initial pull + count on mount
  useEffect(() => {
    firebasePromise.then(async () => {
      await countPending();
      if (isFirebaseEnabled && navigator.onLine) {
        try {
          const pulled = await pullAllFromCloud();
          console.log(`[Sync] Initial pull: ${pulled} documents`);
        } catch { /* offline — no worries */ }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  // Auto-sync on reconnect
  useEffect(() => {
    const handleOnline = () => { syncNow(); };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [syncNow]);

  // Periodic sync: only PUSH pending sales (never pull — avoids restoring deleted items)
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!navigator.onLine || !businessId || !user) return;
      // Only push — no pull
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
        // Mark all as synced when offline (no Firebase)
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
      syncPendingCount,
      notifySaleCreated,
      syncNow,
      syncing,
      lastSyncAt,
      firestorePath,
      firebaseConnected,
      lastSyncResult,
      pushBranch,
      pushBranchUser,
      pushCategory,
      pushProduct,
      pushCashShift,
      pushInventoryMovement,
      deleteFromFirestore,
      deleteFromFirestoreAsync,
      deleteMultipleFromFirestore,
      pullAllFromCloud,
    }),
    [
      syncPendingCount, notifySaleCreated, syncNow, syncing, lastSyncAt,
      firestorePath, firebaseConnected, lastSyncResult,
      pushBranch, pushBranchUser, pushCategory, pushProduct,
      pushCashShift, pushInventoryMovement, deleteFromFirestore, deleteFromFirestoreAsync, deleteMultipleFromFirestore, pullAllFromCloud,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
