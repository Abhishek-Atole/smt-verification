import { useState, useMemo, type CSSProperties } from "react";
import { useAdmin } from "../admin-context";

export default function AuditLog() {
  const { auditLog } = useAdmin();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [showArchive, setShowArchive] = useState(false);

  // Action names come straight from the backend AuditEvent taxonomy — derive
  // the filter options from whatever's currently loaded rather than a hardcoded
  // list, so new event types show up automatically.
  const actionOptions = useMemo(
    () => [...new Set(auditLog.map((e) => e.action))].sort(),
    [auditLog],
  );

  const filtered = useMemo(() => {
    let items = auditLog;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((e) =>
        e.details.toLowerCase().includes(q) || e.actor.toLowerCase().includes(q) || e.action.toLowerCase().includes(q)
      );
    }
    if (actionFilter) items = items.filter((e) => e.action === actionFilter);
    if (outcomeFilter) items = items.filter((e) => e.outcome === outcomeFilter);
    return items;
  }, [auditLog, search, actionFilter, outcomeFilter]);

  function exportCSV() {
    const csv = "timestamp,action,actor,target,details,outcome\n" +
      filtered.map((e) =>
        `"${e.timestamp}","${e.action}","${e.actor}","${e.target ?? ""}","${e.details.replace(/"/g, '""')}","${e.outcome}"`
      ).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const style: Record<string, CSSProperties> = {
    filterInput: {
      width: "100%", padding: "0.5rem 0.75rem", background: "#0d1224", border: "1px solid #1e2a3a",
      borderRadius: 6, color: "#e2e8f0", fontFamily: "inherit", fontSize: 13, outline: "none", boxSizing: "border-box",
    },
    select: {
      padding: "0.4rem 0.5rem", background: "#0d1224", border: "1px solid #1e2a3a",
      borderRadius: 6, color: "#e2e8f0", fontFamily: "inherit", fontSize: 12, outline: "none",
    },
  };

  const badgeStyle = (outcome: string): CSSProperties => ({
    fontSize: 10, padding: "1px 6px", borderRadius: 4, textTransform: "uppercase",
    background: outcome === "success" ? "rgba(0,255,136,0.15)" : outcome === "failure" ? "rgba(255,68,68,0.15)" : "rgba(255,170,0,0.15)",
    color: outcome === "success" ? "#00ff88" : outcome === "failure" ? "#ff4444" : "#ffaa00",
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#e2e8f0" }}>
          Audit Log
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={exportCSV} style={smallBtn}>Export CSV</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <input
            placeholder="Search details, actor, action..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={style.filterInput}
          />
        </div>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={style.select}>
          <option value="">All actions</option>
          {actionOptions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)} style={style.select}>
          <option value="">All outcomes</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="warning">Warning</option>
        </select>
        <label style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={showArchive} onChange={() => setShowArchive(!showArchive)} />
          Show archived
        </label>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e2a3a" }}>
              {["Timestamp", "Action", "Actor", "Target", "Details", "Outcome"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "0.6rem 0.75rem", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>No audit entries found. Adjust filters or check back later.</td>
              </tr>
            ) : (
              filtered.slice().reverse().map((e) => (
                <tr key={e.id} style={{ borderBottom: "1px solid rgba(30,42,58,0.5)" }}>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#64748b", whiteSpace: "nowrap", fontSize: 12 }}>{e.timestamp}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#94a3b8", fontSize: 12 }}>{e.action}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#cbd5e1" }}>{e.actor}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#64748b" }}>{e.target ?? "\u2014"}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#cbd5e1", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.details}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    <span style={badgeStyle(e.outcome)}>{e.outcome}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, color: "#64748b", marginTop: "0.5rem" }}>
        Showing {filtered.length} of {auditLog.length} entries
      </div>
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  padding: "0.4rem 0.75rem", background: "#0d1224", border: "1px solid #1e2a3a",
  borderRadius: 6, color: "#94a3b8", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};
