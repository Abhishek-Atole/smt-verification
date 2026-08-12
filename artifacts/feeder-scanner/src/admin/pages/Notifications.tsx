import { useState } from "react";
import { useAdmin } from "../admin-context";
import type { SystemBroadcast } from "../admin-types";

export default function NotificationsPage() {
  const { broadcasts, addBroadcast, removeBroadcast } = useAdmin();
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<"info" | "warning" | "critical">("info");
  const [expires, setExpires] = useState("");
  const [dismissible, setDismissible] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  function handleSend() {
    if (!message.trim()) return;
    addBroadcast(message.trim(), severity, expires ? new Date(expires).toISOString() : undefined, dismissible);
    setMessage("");
    setShowCreate(false);
  }

  const severityStyles: Record<string, { bg: string; color: string; label: string }> = {
    info: { bg: "rgba(0,212,255,0.12)", color: "#00d4ff", label: "Info" },
    warning: { bg: "rgba(255,170,0,0.12)", color: "#ffaa00", label: "Warning" },
    critical: { bg: "rgba(255,68,68,0.12)", color: "#ff4444", label: "Critical" },
  };

  const btnStyle: React.CSSProperties = {
    padding: "0.5rem 1rem", background: "#00d4ff", border: "none", borderRadius: 6,
    color: "#0a0e1a", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#e2e8f0" }}>
          Notifications
        </h1>
        <button onClick={() => setShowCreate(!showCreate)} style={btnStyle}>
          + New Broadcast
        </button>
      </div>

      {showCreate && (
        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 1rem", color: "#e2e8f0" }}>
            Create Broadcast
          </h2>
          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Message</div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter broadcast message…"
              rows={3}
              style={{
                width: "100%", padding: "0.5rem 0.75rem", background: "#0d1224",
                border: "1px solid #1e2a3a", borderRadius: 6, color: "#e2e8f0",
                fontFamily: "inherit", fontSize: 13, outline: "none", boxSizing: "border-box", resize: "vertical",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 16, marginBottom: "0.75rem", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Severity</div>
              <div style={{ display: "flex", gap: 4 }}>
                {(["info", "warning", "critical"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSeverity(s)}
                    style={{
                      padding: "0.3rem 0.6rem", border: "1px solid", borderRadius: 4, fontSize: 11,
                      cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize",
                      background: severity === s ? severityStyles[s].bg : "transparent",
                      borderColor: severity === s ? severityStyles[s].color : "#1e2a3a",
                      color: severity === s ? severityStyles[s].color : "#64748b",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Expires</div>
              <input
                type="datetime-local"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                style={{
                  padding: "0.3rem 0.5rem", background: "#0d1224", border: "1px solid #1e2a3a",
                  borderRadius: 6, color: "#e2e8f0", fontFamily: "inherit", fontSize: 12, outline: "none",
                }}
              />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", cursor: "pointer", marginTop: 16 }}>
              <input type="checkbox" checked={dismissible} onChange={() => setDismissible(!dismissible)} />
              Dismissible
            </label>
          </div>
          <button onClick={handleSend} disabled={!message.trim()} style={{ ...btnStyle, opacity: message.trim() ? 1 : 0.5 }}>
            Send Broadcast
          </button>
        </div>
      )}

      <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
        <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Active Broadcasts ({broadcasts.length})
        </h2>
        {broadcasts.length === 0 ? (
          <div style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: "1rem 0" }}>No active broadcasts</div>
        ) : (
          broadcasts.map((b) => {
            const style = severityStyles[b.severity] ?? severityStyles.info;
            const expired = b.expiresAt ? new Date(b.expiresAt) < new Date() : false;
            return (
              <div key={b.id} style={{
                padding: "0.75rem", marginBottom: 8, borderRadius: 6, border: "1px solid",
                borderColor: style.color + "40", background: style.bg,
                opacity: expired ? 0.5 : 1,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 4, background: style.color + "20",
                      color: style.color, textTransform: "uppercase", letterSpacing: "0.04em",
                    }}>
                      {b.severity}
                    </span>
                    <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500, flex: 1 }}>
                      {b.message}
                    </span>
                  </div>
                  <button
                    onClick={() => removeBroadcast(b.id)}
                    style={{
                      padding: "0.2rem 0.4rem", background: "transparent", border: "none",
                      color: "#64748b", fontSize: 16, cursor: "pointer", lineHeight: 1,
                    }}
                    title="Delete"
                  >
                    &times;
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 12 }}>
                  <span>{b.createdAt}</span>
                  {b.expiresAt && <span>Expires: {new Date(b.expiresAt).toLocaleString()}</span>}
                  <span>{dismissible ? "Dismissible" : "Non-dismissible"}</span>
                  <span>{b.readBy.length} read</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
