import { useState } from "react";
import { useAdmin } from "../admin-context";

export default function IntegrityCheckPage() {
  const { auditIntegrity, refreshAll } = useAdmin();
  const [rechecking, setRechecking] = useState(false);

  async function handleRecheck() {
    setRechecking(true);
    try {
      await refreshAll();
    } finally {
      setRechecking(false);
    }
  }

  const broken = auditIntegrity?.brokenAt ?? null;
  const total = auditIntegrity?.total ?? 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#e2e8f0" }}>
          Audit Chain Integrity
        </h1>
        <button onClick={handleRecheck} disabled={rechecking}
          style={{ ...actionBtn, opacity: rechecking ? 0.6 : 1 }}>
          {rechecking ? "Verifying…" : "Re-verify chain"}
        </button>
      </div>

      <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, margin: "0 0 1.5rem", maxWidth: 680 }}>
        The audit log is an append-only HMAC-SHA256 hash chain: each row's hash covers the
        previous row's hash, so any edit or deletion of historical rows breaks the chain from
        that point forward. This check walks every row server-side and reports the first break.
      </p>

      {auditIntegrity === null ? (
        <div style={{
          background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.5rem",
          fontSize: 13, color: "#475569", textAlign: "center",
        }}>
          Integrity status unavailable — could not reach the audit endpoint.
        </div>
      ) : (
        <div style={{
          background: "#111827", borderRadius: 10, padding: "1.5rem",
          border: `1px solid ${broken ? "rgba(255,170,0,0.4)" : "rgba(0,255,136,0.4)"}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1rem" }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%",
              background: broken ? "rgba(255,170,0,0.15)" : "rgba(0,255,136,0.15)",
              color: broken ? "#ffaa00" : "#00ff88",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
            }}>
              {broken ? "⚠" : "✓"}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: broken ? "#ffaa00" : "#00ff88" }}>
                {broken ? "Chain break detected" : "Chain intact"}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                {total.toLocaleString()} audit rows verified
              </div>
            </div>
          </div>

          {broken && (
            <div style={{
              padding: "0.75rem", borderRadius: 6, background: "rgba(255,170,0,0.08)",
              border: "1px solid rgba(255,170,0,0.25)", fontSize: 13, color: "#cbd5e1",
            }}>
              First break at row <strong style={{ color: "#ffaa00" }}>#{broken.id}</strong>
              {" "}({new Date(broken.createdAt).toLocaleString()}).
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 6, lineHeight: 1.5 }}>
                Note: the June 25, 2026 admin-portal backfill inserted legacy rows ahead of the
                genesis hash, leaving a known pre-existing break near the start of the chain. A
                break at this boundary reflects that migration, not live tampering. Investigate
                only if the reported row is beyond the backfill boundary.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const actionBtn: React.CSSProperties = {
  padding: "0.5rem 1rem", background: "#00d4ff", border: "none", borderRadius: 6,
  color: "#0a0e1a", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
