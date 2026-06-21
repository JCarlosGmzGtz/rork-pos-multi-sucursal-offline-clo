import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Store,
  LogIn,
  Building2,
  User,
  ChevronRight,
  ArrowLeft,
  Plus,
  Shield,
  KeyRound,
  AlertCircle,
  Mail,
} from "lucide-react";
import { useAuth, type FirebaseSession } from "@/contexts/AuthContext";
import { db, type Branch, type BranchUser } from "@/db/database";
import { seedDatabase } from "@/db/seed";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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

const DEMO_BUSINESS_ID = "demo-business";

/** Step of the login flow. */
type Step = "firebase" | "select";

export default function Login() {
  const {
    user,
    firebaseSession,
    login,
    completeLogin,
    demoLogin,
    logout: fbLogout,
    isDemoMode,
  } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("firebase");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  // Branch + user selection state
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchUsers, setBranchUsers] = useState<BranchUser[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  // New branch user dialog
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserPin, setNewUserPin] = useState("");


  // New branch dialog
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchAddress, setNewBranchAddress] = useState("");
  const [newBranchPhone, setNewBranchPhone] = useState("");

  // Redirect if already logged in
  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  // When Firebase session is set, move to selection step
  useEffect(() => {
    if (firebaseSession) setStep("select");
  }, [firebaseSession]);

  // Load branches for current business
  const businessId = firebaseSession?.uid ?? DEMO_BUSINESS_ID;

  useEffect(() => {
    if (step !== "select") return;
    (async () => {
      await seedDatabase(businessId);
      const all = await db.branches.where("businessId").equals(businessId).toArray();
      setBranches(all);
      if (all.length > 0) setSelectedBranchId(all[0].id);
    })();
  }, [step, businessId]);

  // Load branch users when branch changes
  useEffect(() => {
    if (!selectedBranchId) {
      setBranchUsers([]);
      return;
    }
    (async () => {
      const users = await db.branchUsers
        .where("branchId")
        .equals(selectedBranchId)
        .toArray();
      setBranchUsers(users);
      setSelectedUserId("");
      setPinInput("");
      setPinError("");
    })();
  }, [selectedBranchId]);

  // Clear PIN when selected user changes
  useEffect(() => {
    setPinInput("");
    setPinError("");
  }, [selectedUserId]);

  const handleFirebaseLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error("Ingresa email y contraseña");
      return;
    }
    setLoggingIn(true);
    try {
      await login(email, password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al iniciar sesión";
      toast.error(msg);
      setLoggingIn(false);
    }
  };

  const handleCompleteLogin = async () => {
    const branch = branches.find((b) => b.id === selectedBranchId);
    const bu = branchUsers.find((u) => u.id === selectedUserId);

    if (!branch) {
      toast.error("Selecciona una sucursal");
      return;
    }
    if (!bu) {
      toast.error("Selecciona un usuario");
      return;
    }
    if (!pinInput.trim()) {
      setPinError("Ingresa el PIN del usuario");
      return;
    }

    // Verify PIN against Dexie
    const storedUser = await db.branchUsers.get(bu.id);
    if (!storedUser || storedUser.pin !== pinInput.trim()) {
      setPinError("PIN incorrecto");
      return;
    }

    const accessibleIds =
      bu.accessibleBranchIds ??
      (bu.role === "admin" || bu.isOwner ? [] : [selectedBranchId]);

    if (isDemoMode || !firebaseSession) {
      demoLogin(branch.id, bu.id, bu.name, bu.role, bu.isOwner, accessibleIds);
    } else {
      completeLogin(
        branch.id,
        bu.id,
        bu.name,
        bu.role,
        bu.isOwner,
        accessibleIds,
      );
    }
  };

  const handleCreateUser = async () => {
    if (!newUserName.trim() || !newUserPin.trim() || !selectedBranchId) {
      toast.error("Completa todos los campos");
      return;
    }
    const id = crypto.randomUUID();
    await db.branchUsers.add({
      id,
      businessId,
      branchId: selectedBranchId,
      name: newUserName.trim(),
      pin: newUserPin.trim(),
      role: "cajero",
      isOwner: false,
      accessibleBranchIds: [selectedBranchId],
      createdAt: Date.now(),
    });
    // Refresh list
    const users = await db.branchUsers
      .where("branchId")
      .equals(selectedBranchId)
      .toArray();
    setBranchUsers(users);
    setSelectedUserId(id);
    setNewUserOpen(false);
    setNewUserName("");
    setNewUserPin("");
    toast.success("Usuario creado");
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) {
      toast.error("El nombre de la sucursal es requerido");
      return;
    }
    const id = crypto.randomUUID();
    await db.branches.add({
      id,
      businessId,
      name: newBranchName.trim(),
      address: newBranchAddress.trim(),
      phone: newBranchPhone.trim(),
      createdAt: Date.now(),
    });

    // Reload branches
    const all = await db.branches
      .where("businessId")
      .equals(businessId)
      .toArray();
    setBranches(all);
    setSelectedBranchId(id);
    setNewBranchOpen(false);
    setNewBranchName("");
    setNewBranchAddress("");
    setNewBranchPhone("");
    toast.success("Sucursal creada");
  };

  const handleSwitchAccount = async () => {
    await fbLogout();
    setStep("firebase");
    setEmail("");
    setPassword("");
    setPinInput("");
    setPinError("");
  };

  // --- Firebase Auth Step ---
  if (step === "firebase") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
        <Card className="w-full max-w-md border-slate-700 bg-slate-800 p-8 shadow-2xl">
          {/* Logo */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500">
              <Store className="h-7 w-7 text-slate-900" />
            </div>
            <h1 className="text-2xl font-bold text-white">PuntoFlex</h1>
            <p className="mt-1 text-sm text-slate-400">
              POS Multi Sucursal
            </p>
          </div>

          {/* Firebase Login Form */}
          <form onSubmit={handleFirebaseLogin} className="space-y-4">
            <p className="text-center text-xs font-medium uppercase tracking-wider text-slate-500">
              Iniciar Sesión — Negocio
            </p>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@empresa.com"
                autoFocus
                className="border-slate-600 bg-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300">
                Contraseña
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="border-slate-600 bg-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
            <Button
              type="submit"
              disabled={loggingIn}
              className="w-full bg-amber-500 py-6 text-base font-bold text-white hover:bg-amber-600"
            >
              {loggingIn ? "Ingresando..." : "Iniciar Sesión"}
            </Button>
          </form>

          <Separator className="my-6 bg-slate-700" />

          {/* Demo Mode — quick select */}
          <div className="space-y-3">
            <p className="text-center text-xs font-medium uppercase tracking-wider text-slate-500">
              O usa el Modo Demo
            </p>
            <Button
              onClick={() => setStep("select")}
              variant="outline"
              className="w-full border-slate-600 bg-slate-700 py-5 text-white hover:bg-slate-600"
            >
              Entrar sin cuenta
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // --- Branch + User Selection Step ---
  const selectedBranch = branches.find((b) => b.id === selectedBranchId);
  const selectedUser = branchUsers.find((u) => u.id === selectedUserId);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <Card className="w-full max-w-lg border-slate-700 bg-slate-800 p-8 shadow-2xl">
        {/* Header — Business Identity */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500">
            <Building2 className="h-6 w-6 text-slate-900" />
          </div>
          {firebaseSession ? (
            <>
              <div className="flex items-center justify-center gap-2">
                <Mail className="h-3.5 w-3.5 text-slate-500" />
                <h1 className="text-lg font-bold text-white">
                  {firebaseSession.email}
                </h1>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                Selecciona sucursal, usuario y PIN para ingresar
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-white">Modo Demo</h1>
              <p className="mt-1 text-sm text-slate-400">
                Selecciona sucursal y usuario para ingresar
              </p>
            </>
          )}
        </div>

        {/* Action buttons — switch account / login */}
        <div className="mb-5 flex items-center justify-between">
          {firebaseSession ? (
            <button
              onClick={handleSwitchAccount}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Cambiar cuenta
            </button>
          ) : (
            <button
              onClick={() => {
                setStep("firebase");
                setPinInput("");
                setPinError("");
              }}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Iniciar sesión
            </button>
          )}
          {firebaseSession && (
            <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-medium text-amber-400">
              Dueño
            </span>
          )}
        </div>

        <div className="space-y-5">
          {/* Branch Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium text-slate-300">
                Sucursal
              </Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNewBranchOpen(true)}
                className="h-7 text-xs text-amber-400 hover:text-amber-300"
              >
                <Plus className="mr-1 h-3 w-3" />
                Nueva
              </Button>
            </div>
            {branches.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-600 p-6 text-center">
                <Building2 className="mx-auto mb-2 h-8 w-8 text-slate-600" />
                <p className="text-sm text-slate-500">No hay sucursales</p>
                <Button
                  onClick={() => setNewBranchOpen(true)}
                  variant="outline"
                  size="sm"
                  className="mt-3 border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Crear primera sucursal
                </Button>
              </div>
            ) : (
              <div className="grid gap-2 max-h-48 overflow-y-auto">
                {branches.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setSelectedBranchId(b.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all",
                      selectedBranchId === b.id
                        ? "border-amber-500 bg-amber-500/10 text-amber-300"
                        : "border-slate-700 text-slate-400 hover:border-slate-500",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-lg",
                        selectedBranchId === b.id
                          ? "bg-amber-500/20"
                          : "bg-slate-700",
                      )}
                    >
                      <Building2
                        className={cn(
                          "h-4 w-4",
                          selectedBranchId === b.id
                            ? "text-amber-400"
                            : "text-slate-500",
                        )}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{b.name}</p>
                      <p className="text-[11px] truncate text-slate-500">
                        {b.address}
                      </p>
                    </div>
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 shrink-0 transition-colors",
                        selectedBranchId === b.id
                          ? "text-amber-400"
                          : "text-slate-600",
                      )}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Branch User Selection */}
          {selectedBranchId && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium text-slate-300">
                  Usuario de sucursal
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNewUserOpen(true)}
                  className="h-7 text-xs text-amber-400 hover:text-amber-300"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Nuevo
                </Button>
              </div>
              {branchUsers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-600 p-4 text-center">
                  <User className="mx-auto mb-2 h-6 w-6 text-slate-600" />
                  <p className="text-sm text-slate-500">
                    No hay usuarios en esta sucursal
                  </p>
                  <Button
                    onClick={() => setNewUserOpen(true)}
                    variant="outline"
                    size="sm"
                    className="mt-2 border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Crear usuario
                  </Button>
                </div>
              ) : (
                <div className="grid gap-2 max-h-48 overflow-y-auto">
                  {branchUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all",
                        selectedUserId === u.id
                          ? "border-amber-500 bg-amber-500/10 text-amber-300"
                          : "border-slate-700 text-slate-400 hover:border-slate-500",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                          selectedUserId === u.id
                            ? "bg-amber-500 text-white"
                            : u.role === "admin"
                              ? "bg-violet-500/30 text-violet-300"
                              : "bg-slate-700 text-slate-400",
                        )}
                      >
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-[11px] text-slate-500 capitalize">
                          {u.role}
                        </p>
                      </div>
                      {u.isOwner && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 shrink-0">
                          Dueño
                        </span>
                      )}
                      {u.role === "admin" && !u.isOwner && (
                        <Shield className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PIN Input — only shown when a user is selected */}
          {selectedUserId && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-300">
                <KeyRound className="mr-1 inline h-3.5 w-3.5" />
                PIN del usuario
              </Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setPinError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCompleteLogin();
                }}
                placeholder="Ingresa el PIN de 6 dígitos"
                autoFocus
                className={cn(
                  "border-slate-600 bg-slate-700 text-white text-center text-lg tracking-[0.5em] placeholder:tracking-normal placeholder:text-sm placeholder:text-slate-500",
                  pinError && "border-red-500",
                )}
              />
              {pinError && (
                <p className="flex items-center gap-1 text-xs text-red-400">
                  <AlertCircle className="h-3 w-3" />
                  {pinError}
                </p>
              )}
            </div>
          )}

          {/* Enter Button */}
          <Button
            onClick={handleCompleteLogin}
            className="w-full bg-amber-500 py-6 text-base font-bold text-white hover:bg-amber-600 active:scale-[0.98] transition-transform"
            disabled={!selectedBranchId || !selectedUserId}
          >
            <LogIn className="mr-2 h-4 w-4" />
            {selectedUser
              ? `Ingresar como ${selectedUser.name}`
              : "Selecciona sucursal y usuario"}
          </Button>
        </div>

        {/* New Branch Dialog */}
        <Dialog open={newBranchOpen} onOpenChange={setNewBranchOpen}>
          <DialogContent className="sm:max-w-md border-slate-700 bg-slate-800 text-white">
            <DialogHeader>
              <DialogTitle className="text-white">Nueva Sucursal</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Nombre</Label>
                <Input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  className="border-slate-600 bg-slate-700 text-white"
                  placeholder="Ej. Sucursal Centro"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Dirección</Label>
                <Input
                  value={newBranchAddress}
                  onChange={(e) => setNewBranchAddress(e.target.value)}
                  className="border-slate-600 bg-slate-700 text-white"
                  placeholder="Ej. Av. Reforma 123"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Teléfono</Label>
                <Input
                  value={newBranchPhone}
                  onChange={(e) => setNewBranchPhone(e.target.value)}
                  className="border-slate-600 bg-slate-700 text-white"
                  placeholder="Ej. 555-0101"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setNewBranchOpen(false)}
                className="border-slate-600 text-slate-300"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreateBranch}
                className="bg-amber-500 hover:bg-amber-600"
              >
                Crear Sucursal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* New Branch User Dialog */}
        <Dialog open={newUserOpen} onOpenChange={setNewUserOpen}>
          <DialogContent className="sm:max-w-md border-slate-700 bg-slate-800 text-white">
            <DialogHeader>
              <DialogTitle className="text-white">Nuevo Usuario</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Nombre</Label>
                <Input
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="border-slate-600 bg-slate-700 text-white"
                  placeholder="Ej. Juan Pérez"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">PIN (6 dígitos)</Label>
                <Input
                  value={newUserPin}
                  onChange={(e) =>
                    setNewUserPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className="border-slate-600 bg-slate-700 text-white"
                  placeholder="123456"
                  maxLength={6}
                  inputMode="numeric"
                  type="password"
                />
              </div>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
                <p className="text-xs text-amber-300 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  Los nuevos usuarios se crean como Cajero. Solo el dueño puede crear Administradores desde Empleados.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setNewUserOpen(false)}
                className="border-slate-600 text-slate-300"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreateUser}
                className="bg-amber-500 hover:bg-amber-600"
              >
                Crear Usuario
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </div>
  );
}
