import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import StoreLogin from "./StoreLogin";
import StoreDashboard from "./StoreDashboard";

// Isolated store sub-app. Unlike AdminGate (separate admin cookie), the store
// uses the shared auth context and requires a "storekeeper" session.
export function StoreGate() {
  const { user, loading, logout } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user?.mustChangePassword) {
      setLocation("/change-password");
    }
  }, [user, setLocation]);

  if (loading) {
    return (
      <div style={{
        position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0a0e1a", color: "#64748b", fontFamily: "'JetBrains Mono','Fira Code',monospace", zIndex: 9999,
      }}>
        Verifying…
      </div>
    );
  }

  if (!user || user.role !== "storekeeper") {
    return <StoreLogin />;
  }

  if (user.mustChangePassword) {
    return null;
  }

  return (
    <StoreShell onLogout={logout}>
      <StoreDashboard />
    </StoreShell>
  );
}

function StoreShell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="text-lg font-black tracking-tight">STORE</span>
        <Button variant="outline" size="sm" onClick={onLogout}>
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </header>
      <main>{children}</main>
    </div>
  );
}
