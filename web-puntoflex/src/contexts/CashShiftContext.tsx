import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { doc, setDoc } from "firebase/firestore";
import { getDB, isFirebaseEnabled } from "@/lib/firebase";
import { db, type CashShift } from "@/db/database";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";

interface CashShiftContextValue {
  /** The currently active (open) shift, or null. */
  activeShift: CashShift | null;
  /** Sum of sales registered under the active shift. */
  shiftSalesTotal: number;
  /** True while loading shift state from Dexie. */
  loading: boolean;
  /** Open a new shift with the given initial cash. */
  openShift: (initialCash: number) => Promise<void>;
  /** Close the active shift with declared cash. Returns the final shift record. */
  closeShift: (declaredCash: number) => Promise<CashShift>;
}

const CashShiftContext = createContext<CashShiftContextValue | null>(null);

export function CashShiftProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const [activeShift, setActiveShift] = useState<CashShift | null>(null);
  const [shiftSalesTotal, setShiftSalesTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const businessId = user?.businessId ?? "";
  const branchId = currentBranch?.id ?? "";
  const branchUserId = user?.branchUserId ?? "";

  // Load active shift on mount/when branch/user changes
  useEffect(() => {
    if (!businessId || !branchId || !branchUserId) {
      setActiveShift(null);
      setShiftSalesTotal(0);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const shifts = await db.cashShifts
          .where("businessId").equals(businessId)
          .toArray();

        const open = shifts.find(
          (s) =>
            s.branchId === branchId &&
            s.branchUserId === branchUserId &&
            s.status === "open",
        );

        if (cancelled) return;

        if (open) {
          setActiveShift(open);
          // Compute total sales for this shift
          const sales = await db.sales
            .where("shiftId").equals(open.id)
            .toArray();
          const total = sales.reduce((sum, s) => sum + s.total, 0);
          setShiftSalesTotal(Math.round(total * 100) / 100);
        } else {
          setActiveShift(null);
          setShiftSalesTotal(0);
        }
      } catch (err) {
        console.error("[CashShift] Failed to load active shift:", err);
        if (!cancelled) {
          setActiveShift(null);
          setShiftSalesTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [businessId, branchId, branchUserId]);

  const openShift = useCallback(
    async (initialCash: number) => {
      if (!businessId || !branchId || !branchUserId) {
        throw new Error("Missing business, branch, or user context");
      }

      const shift: CashShift = {
        id: crypto.randomUUID(),
        businessId,
        branchId,
        branchUserId,
        initialCash,
        totalSales: 0,
        declaredCash: 0,
        difference: 0,
        status: "open",
        openedAt: Date.now(),
        closedAt: 0,
        synced: 0,
      };

      await db.cashShifts.add(shift);

      // Sync to Firestore if available — fire-and-forget, never block the UI
      if (isFirebaseEnabled && navigator.onLine) {
        const firestore = getDB();
        if (firestore) {
          setDoc(
            doc(firestore, "businesses", businessId, "cash_shifts", shift.id),
            shift,
          )
            .then(() => db.cashShifts.update(shift.id, { synced: 1 } as Partial<CashShift>))
            .catch(() => { /* offline — will sync later */ });
        }
      }

      setActiveShift(shift);
      setShiftSalesTotal(0);
    },
    [businessId, branchId, branchUserId],
  );

  const closeShift = useCallback(
    async (declaredCash: number): Promise<CashShift> => {
      if (!activeShift) throw new Error("No hay turno activo para cerrar");

      const totalSales = await db.sales
        .where("shiftId").equals(activeShift.id)
        .toArray()
        .then((sales) => sales.reduce((sum, s) => sum + s.total, 0));

      const expectedCash = activeShift.initialCash + totalSales;
      const difference = Math.round((declaredCash - expectedCash) * 100) / 100;

      const closed: CashShift = {
        ...activeShift,
        totalSales: Math.round(totalSales * 100) / 100,
        declaredCash,
        difference,
        status: "closed",
        closedAt: Date.now(),
      };

      await db.cashShifts.update(activeShift.id, closed);

      // Sync to Firestore if available — fire-and-forget, never block the UI
      if (isFirebaseEnabled && navigator.onLine) {
        const firestore = getDB();
        if (firestore) {
          setDoc(
            doc(firestore, "businesses", businessId, "cash_shifts", activeShift.id),
            closed,
          )
            .then(() => db.cashShifts.update(activeShift.id, { synced: 1 } as Partial<CashShift>))
            .catch(() => { /* offline — will sync later */ });
        }
      }

      setActiveShift(null);
      setShiftSalesTotal(0);
      return closed;
    },
    [activeShift, businessId],
  );

  const value = useMemo<CashShiftContextValue>(
    () => ({
      activeShift,
      shiftSalesTotal,
      loading,
      openShift,
      closeShift,
    }),
    [activeShift, shiftSalesTotal, loading, openShift, closeShift],
  );

  return (
    <CashShiftContext.Provider value={value}>
      {children}
    </CashShiftContext.Provider>
  );
}

export function useCashShift(): CashShiftContextValue {
  const ctx = useContext(CashShiftContext);
  if (!ctx) throw new Error("useCashShift must be used within CashShiftProvider");
  return ctx;
}
