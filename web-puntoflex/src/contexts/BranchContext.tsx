import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { db, type Branch } from "@/db/database";
import { seedDatabase } from "@/db/seed";
import { useAuth } from "@/contexts/AuthContext";

interface BranchContextValue {
  branches: Branch[];
  currentBranch: Branch | null;
  setCurrentBranch: (branch: Branch) => void;
  loading: boolean;
  /** Force-reload branches from Dexie (call after mutations). */
  refreshBranches: () => Promise<void>;
}

const BranchContext = createContext<BranchContextValue | null>(null);

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialised, setInitialised] = useState(false);

  const businessId = user?.businessId;

  // Load branches scoped to the user's business
  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        await seedDatabase(businessId);
        const all = await db.branches.where("businessId").equals(businessId).toArray();
        if (cancelled) return;
        setBranches(all);
        if (all.length > 0) {
          // Restore branch from localStorage first, then user session, then fallback
          const savedBranchId = localStorage.getItem("puntoflex-branch");
          setCurrentBranch((prev) => {
            if (prev && all.find((b) => b.id === prev.id)) return prev;
            const fromStorage = savedBranchId ? all.find((b) => b.id === savedBranchId) : null;
            if (fromStorage) return fromStorage;
            const matched = user?.branchId ? all.find((b) => b.id === user.branchId) : null;
            return matched ?? all[0];
          });
        }
        setLoading(false);
        setInitialised(true);
      } catch (err) {
        console.error("[BranchContext] Failed to load branches:", err);
        if (!cancelled) {
          setLoading(false);
          setInitialised(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [businessId, user?.branchId]);

  const handleSetBranch = useCallback((branch: Branch) => {
    setCurrentBranch(branch);
    localStorage.setItem("puntoflex-branch", branch.id);
  }, []);

  const refreshBranches = useCallback(async () => {
    if (!businessId) return;
    const all = await db.branches.where("businessId").equals(businessId).toArray();
    setBranches(all);
    // Keep current branch if still valid, else pick first
    setCurrentBranch((prev) => {
      if (prev && all.find((b) => b.id === prev.id)) return prev;
      return all[0] ?? null;
    });
  }, [businessId]);

  const value = useMemo<BranchContextValue>(
    () => ({ branches, currentBranch, setCurrentBranch: handleSetBranch, loading, refreshBranches }),
    [branches, currentBranch, handleSetBranch, loading, refreshBranches],
  );

  return (
    <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
  );
}

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
