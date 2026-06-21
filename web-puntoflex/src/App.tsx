import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";

import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SyncProvider } from "@/contexts/SyncContext";
import { BranchProvider } from "@/contexts/BranchContext";
import { CartProvider } from "@/contexts/CartContext";
import { PeripheralsProvider } from "@/contexts/PeripheralsContext";
import { CashShiftProvider } from "@/contexts/CashShiftContext";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import POS from "@/pages/POS";
import Products from "@/pages/Products";
import Sales from "@/pages/Sales";
import Branches from "@/pages/Branches";
import Employees from "@/pages/Employees";
import Hardware from "@/pages/Hardware";
import Transfers from "@/pages/Transfers";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function ProtectedLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Cargando...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <ErrorBoundary>
      <PeripheralsProvider>
        <BranchProvider>
          <CashShiftProvider>
            <CartProvider>
              <Outlet />
            </CartProvider>
          </CashShiftProvider>
        </BranchProvider>
      </PeripheralsProvider>
    </ErrorBoundary>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <SyncProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<ProtectedLayout />}>
                <Route element={<ErrorBoundary><AppLayout /></ErrorBoundary>}>
                  <Route path="/" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
                  <Route path="/pos" element={<ErrorBoundary><POS /></ErrorBoundary>} />
                  <Route path="/products" element={<ErrorBoundary><Products /></ErrorBoundary>} />
                  <Route path="/sales" element={<ErrorBoundary><Sales /></ErrorBoundary>} />
                  <Route path="/branches" element={<ErrorBoundary><Branches /></ErrorBoundary>} />
                  <Route path="/employees" element={<ErrorBoundary><Employees /></ErrorBoundary>} />
                  <Route path="/hardware" element={<ErrorBoundary><Hardware /></ErrorBoundary>} />
                  <Route path="/transfers" element={<ErrorBoundary><Transfers /></ErrorBoundary>} />
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </SyncProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
