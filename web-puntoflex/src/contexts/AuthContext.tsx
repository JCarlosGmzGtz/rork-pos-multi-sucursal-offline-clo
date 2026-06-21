import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from "firebase/auth";
import { getFBLAuth, isFirebaseEnabled, firebasePromise } from "@/lib/firebase";
import { db } from "@/db/database";
import { seedDatabase } from "@/db/seed";

/** Application user — wraps Firebase auth + selected branch user session. */
export interface AppUser {
  /** Firebase UID — also the businessId. */
  id: string;
  businessId: string;
  email: string;
  /** Display name from Firebase, or email fallback. */
  name: string;
  /** Selected branch ID for this session. */
  branchId: string;
  /** Selected branch-level user ID. */
  branchUserId: string;
  /** Name of the selected branch-level user. */
  branchUserName: string;
  /** Role of the selected branch-level user. */
  role: "admin" | "cajero";
  /** True if this user is the business owner (Firebase account holder). */
  isOwner: boolean;
  /** Branch IDs this user can access (for cross-branch inventory viewing). */
  accessibleBranchIds: string[];
}

/** Raw Firebase auth result before branch + user selection. */
export interface FirebaseSession {
  uid: string;
  email: string;
  displayName: string;
}

interface AuthContextValue {
  /** Null until branch+user selection completes. */
  user: AppUser | null;
  /** Raw Firebase session, set after Firebase auth but before branch selection. */
  firebaseSession: FirebaseSession | null;
  login: (email: string, password: string) => Promise<void>;
  /** Finalise login by selecting a branch and branch user. */
  completeLogin: (
    branchId: string,
    branchUserId: string,
    branchUserName: string,
    role: "admin" | "cajero",
    isOwner?: boolean,
    accessibleBranchIds?: string[],
  ) => void;
  /** Demo login: directly select branch + user without Firebase. */
  demoLogin: (
    branchId: string,
    branchUserId: string,
    branchUserName: string,
    role: "admin" | "cajero",
    isOwner?: boolean,
    accessibleBranchIds?: string[],
  ) => void;
  logout: () => Promise<void>;
  loading: boolean;
  isDemoMode: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Generate a deterministic demo businessId. */
const DEMO_BUSINESS_ID = "demo-business";

function buildAppUser(
  fbSession: FirebaseSession | null,
  branchId: string,
  branchUserId: string,
  branchUserName: string,
  role: "admin" | "cajero",
  isDemo: boolean,
  isOwner = false,
  accessibleBranchIds: string[] = [],
): AppUser {
  const bid = isDemo ? DEMO_BUSINESS_ID : fbSession?.uid ?? "";
  return {
    id: fbSession?.uid ?? bid,
    businessId: bid,
    email: fbSession?.email ?? "",
    name: fbSession?.displayName || fbSession?.email || branchUserName,
    branchId,
    branchUserId,
    branchUserName,
    role,
    isOwner,
    accessibleBranchIds,
  };
}

/**
 * On first login for a business, auto-create the owner branch user
 * and a default branch so the owner can get started immediately.
 */
async function ensureOwnerExists(businessId: string, ownerEmail: string, ownerName: string): Promise<{
  branchId: string;
  ownerUserId: string;
}> {
  // Check if owner already exists
  const existingOwners = await db.branchUsers
    .where("businessId").equals(businessId)
    .toArray()
    .then((users) => users.filter((u) => u.isOwner));

  if (existingOwners.length > 0) {
    // Owner exists — return the first branch they're linked to
    const owner = existingOwners[0];
    return { branchId: owner.branchId, ownerUserId: owner.id };
  }

  // Seed base data (categories, branches, products)
  await seedDatabase(businessId);

  // Find or create the owner branch user
  const branches = await db.branches.where("businessId").equals(businessId).toArray();
  const firstBranch = branches[0];

  if (!firstBranch) {
    // Edge case: seed didn't create branches — create one now
    const branchId = crypto.randomUUID();
    await db.branches.add({
      id: branchId,
      businessId,
      name: "Principal",
      address: "",
      phone: "",
      createdAt: Date.now(),
    });
    const ownerId = crypto.randomUUID();
    await db.branchUsers.add({
      id: ownerId,
      businessId,
      branchId,
      name: ownerName || ownerEmail,
      pin: "123456",
      role: "admin",
      isOwner: true,
      accessibleBranchIds: [],
      createdAt: Date.now(),
    });
    return { branchId, ownerUserId: ownerId };
  }

  // Link owner to the first branch (owner has access to all via empty accessibleBranchIds)
  const ownerId = crypto.randomUUID();
  await db.branchUsers.add({
    id: ownerId,
    businessId,
    branchId: firstBranch.id,
    name: ownerName || ownerEmail,
    pin: "123456",
    role: "admin",
    isOwner: true,
    accessibleBranchIds: [],
    createdAt: Date.now(),
  });

  return { branchId: firstBranch.id, ownerUserId: ownerId };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [firebaseSession, setFirebaseSession] = useState<FirebaseSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    firebasePromise.then(() => setFirebaseReady(true));
  }, []);

  // Firebase Auth listener
  useEffect(() => {
    if (!isFirebaseEnabled || !firebaseReady) {
      setLoading(false);
      return;
    }

    const auth = getFBLAuth();
    if (!auth) { setLoading(false); return; }

    const unsub = onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
      if (fbUser) {
        const session: FirebaseSession = {
          uid: fbUser.uid,
          email: fbUser.email ?? "",
          displayName: fbUser.displayName ?? fbUser.email ?? "",
        };
        setFirebaseSession(session);
        setDemoMode(false);

        // Restore previous branch+user session from localStorage
        const saved = localStorage.getItem(`puntoflex-session-${fbUser.uid}`);
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as {
              branchId: string;
              branchUserId: string;
              branchUserName: string;
              role: "admin" | "cajero";
              isOwner: boolean;
              accessibleBranchIds: string[];
            };
            setUser(buildAppUser(
              session,
              parsed.branchId,
              parsed.branchUserId,
              parsed.branchUserName,
              parsed.role,
              false,
              parsed.isOwner,
              parsed.accessibleBranchIds ?? [],
            ));
            setLoading(false);
            return;
          } catch { /* ignore corrupt saved data */ }
        }

        // First login — ensure owner data exists but DON'T auto-login.
        // Let the Login page handle branch + user selection with PIN.
        try {
          await ensureOwnerExists(
            fbUser.uid,
            fbUser.email ?? "",
            fbUser.displayName || fbUser.email?.split("@")[0] || "Dueño",
          );
        } catch { /* Seed/create failed — Login page will handle empty state */ }

        // Keep user null so Login page shows the branch+user selection
        setUser(null);
      } else {
        setFirebaseSession(null);
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsub();
  }, [firebaseReady]);

  const login = useCallback(async (email: string, password: string) => {
    const auth = getFBLAuth();
    if (!auth) throw new Error("Firebase Auth no está configurado");
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged will fire and set firebaseSession
  }, []);

  const completeLogin = useCallback((
    branchId: string,
    branchUserId: string,
    branchUserName: string,
    role: "admin" | "cajero",
    isOwner = false,
    accessibleBranchIds: string[] = [],
  ) => {
    if (!firebaseSession) return;
    const appUser = buildAppUser(firebaseSession, branchId, branchUserId, branchUserName, role, false, isOwner, accessibleBranchIds);
    setUser(appUser);
    setDemoMode(false);
    localStorage.setItem(`puntoflex-session-${firebaseSession.uid}`, JSON.stringify({
      branchId, branchUserId, branchUserName, role, isOwner, accessibleBranchIds,
    }));
  }, [firebaseSession]);

  const demoLogin = useCallback((
    branchId: string,
    branchUserId: string,
    branchUserName: string,
    role: "admin" | "cajero",
    isOwner = false,
    accessibleBranchIds: string[] = [],
  ) => {
    setDemoMode(true);
    const appUser = buildAppUser(null, branchId, branchUserId, branchUserName, role, true, isOwner, accessibleBranchIds);
    setUser(appUser);
    setFirebaseSession(null);
    localStorage.setItem("puntoflex-demo-session", JSON.stringify({
      branchId, branchUserId, branchUserName, role, isOwner, accessibleBranchIds,
    }));
  }, []);

  const logout = useCallback(async () => {
    const auth = getFBLAuth();
    if (isFirebaseEnabled && auth) {
      try { await signOut(auth); } catch { /* offline — clear local */ }
    }
    // Clear saved session
    if (user?.id) {
      localStorage.removeItem(`puntoflex-session-${user.id}`);
    }
    localStorage.removeItem("puntoflex-demo-session");
    setUser(null);
    setFirebaseSession(null);
    setDemoMode(false);
  }, [user?.id]);

  // Restore demo session on first load (Firebase disabled)
  useEffect(() => {
    if (isFirebaseEnabled) return;
    const saved = localStorage.getItem("puntoflex-demo-session");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as {
          branchId: string; branchUserId: string; branchUserName: string;
          role: "admin" | "cajero"; isOwner: boolean; accessibleBranchIds: string[];
        };
        seedDatabase(DEMO_BUSINESS_ID).then(() => {
          setDemoMode(true);
          setUser(buildAppUser(null, parsed.branchId, parsed.branchUserId, parsed.branchUserName, parsed.role, true, parsed.isOwner, parsed.accessibleBranchIds ?? []));
        });
      } catch { /* ignore */ }
    }
    setLoading(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      firebaseSession,
      login,
      completeLogin,
      demoLogin,
      logout,
      loading,
      isDemoMode: demoMode || !isFirebaseEnabled,
    }),
    [user, firebaseSession, login, completeLogin, demoLogin, logout, loading, demoMode],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
