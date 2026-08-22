import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ADMIN_ROUTE } from "./config";
import { adminApi } from "./api";
import AdminLogin from "./pages/AdminLogin";
import AdminFirstRun from "./pages/AdminFirstRun";
import { AdminProvider } from "./admin-context";
import AdminShell from "./components/AdminShell";
import Overview from "./pages/Overview";
import UserManagement from "./pages/UserManagement";
import AuditLog from "./pages/AuditLog";
import SystemHealth from "./pages/SystemHealth";
import DataManagement from "./pages/DataManagement";
import PerformancePage from "./pages/Performance";
import SecurityCenter from "./pages/SecurityCenter";
import IntegrityCheckPage from "./pages/IntegrityCheck";
import NotificationsPage from "./pages/Notifications";
import PrintLabels from "./pages/PrintLabels";
import LicensePage from "./pages/License";

export function AdminGate() {
  const [authed, setAuthed] = useState(false);
  const [mustChange, setMustChange] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Ask the backend whether the smt_admin_token cookie is still valid.
    adminApi.me()
      .then((me) => { setAuthed(true); setMustChange(me.mustChange === true); })
      .catch(() => setAuthed(false))
      .finally(() => setChecking(false));
  }, []);

  async function handleLogout() {
    try {
      await adminApi.logout();
    } finally {
      setAuthed(false);
      setMustChange(false);
    }
  }

  if (checking) {
    return (
      <div style={{
        position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0a0e1a", color: "#64748b", fontFamily: "'JetBrains Mono','Fira Code',monospace", zIndex: 9999,
      }}>
        Verifying…
      </div>
    );
  }

  if (!authed) {
    return <AdminLogin onSuccess={(me) => { setAuthed(true); setMustChange(me.mustChange === true); }} />;
  }

  // First-login hard gate: the seeded admin must set a new username + password
  // before any Control Panel route works (server also 409s every other route).
  if (mustChange) {
    return <AdminFirstRun onDone={() => setMustChange(false)} onLogout={handleLogout} />;
  }

  return (
    <AdminProvider>
      <AdminShell onLogout={handleLogout}>
        <AdminRouter />
      </AdminShell>
    </AdminProvider>
  );
}

function AdminRouter() {
  const [location] = useLocation();
  const base = ADMIN_ROUTE;
  const path = location.replace(base, "").replace(/^\//, "") || "overview";

  switch (path) {
    case "overview":
      return <Overview />;
    case "users":
      return <UserManagement />;
    case "audit":
      return <AuditLog />;
    case "health":
      return <SystemHealth />;
    case "data":
      return <DataManagement />;
    case "performance":
      return <PerformancePage />;
    case "security":
      return <SecurityCenter />;
    case "integrity":
      return <IntegrityCheckPage />;
    case "notifications":
      return <NotificationsPage />;
    case "labels":
      return <PrintLabels />;
    case "license":
      return <LicensePage />;
    default:
      return <Admin404 />;
  }
}

function Admin404() {
  return (
    <div style={containerStyle}>
      <div style={codeStyle}>404</div>
      <div style={msgStyle}>Not found</div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  minHeight: "60vh", color: "#475569",
};

const codeStyle: React.CSSProperties = {
  fontSize: 48, fontWeight: 700, color: "#1e2a3a", marginBottom: 8,
};

const msgStyle: React.CSSProperties = {
  fontSize: 16, color: "#475569",
};
