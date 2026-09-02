import { useLocation } from "wouter";
import { ADMIN_ROUTE } from "../config";

const NAV_ITEMS = [
  { path: "overview", label: "Overview", icon: "\u25C9" },
  { path: "users", label: "Users", icon: "\u25C9" },
  { path: "audit", label: "Audit Log", icon: "\u25C9" },
  { path: "health", label: "System Health", icon: "\u25C9" },
  { path: "data", label: "Data Management", icon: "\u25C9" },
  { path: "performance", label: "Performance", icon: "\u25C9" },
  { path: "security", label: "Security", icon: "\u25C9" },
  { path: "access", label: "Access Control", icon: "\u25C9" },
  { path: "integrity", label: "Integrity", icon: "\u25C9" },
  { path: "notifications", label: "Notifications", icon: "\u25C9" },
  { path: "labels", label: "Print Labels", icon: "\u25C9" },
  { path: "reports", label: "Report Output", icon: "\u25C9" },
  { path: "license", label: "License", icon: "\u25C9" },
];

export default function AdminNav({ onLogout }: { onLogout: () => void }) {
  const [location, setLocation] = useLocation();
  const base = ADMIN_ROUTE;
  const current = location.replace(base, "").replace(/^\//, "") || "overview";

  function handleNav(path: string) {
    setLocation(`${base}/${path}`);
  }

  return (
    <nav
      style={{
        width: 220, background: "#0d1224", borderRight: "1px solid #1e2a3a",
        display: "flex", flexDirection: "column", padding: "1.5rem 0", flexShrink: 0,
        height: "100vh",
      }}
    >
      <div style={{ padding: "0 1.25rem", marginBottom: "1.5rem" }}>
        <div style={{ fontSize: 11, color: "#00d4ff", letterSpacing: "0.12em", fontWeight: 700 }}>
          UCAL ADMIN
        </div>
        <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Control Panel</div>
      </div>
      <div style={{ flex: 1 }}>
        {NAV_ITEMS.map((item) => {
          const active = current === item.path;
          return (
            <button
              key={item.path}
              onClick={() => handleNav(item.path)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "0.6rem 1.25rem", border: "none", background: "transparent",
                color: active ? "#00d4ff" : "#64748b", fontSize: 13, cursor: "pointer",
                borderLeft: active ? "3px solid #00d4ff" : "3px solid transparent",
                fontFamily: "inherit", textAlign: "left",
                transition: "color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#111827"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid #1e2a3a" }}>
        <button
          onClick={onLogout}
          style={{
            width: "100%", padding: "0.5rem", background: "transparent",
            border: "1px solid #1e2a3a", borderRadius: 6, color: "#94a3b8",
            fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Lock session
        </button>
        <div style={{ fontSize: 10, color: "#475569", marginTop: 8, textAlign: "center" }}>
          v2.0 &middot; Admin
        </div>
      </div>
    </nav>
  );
}
