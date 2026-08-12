import { useState } from "react";
import { useAdmin } from "../admin-context";
import { restoreBackup, readBackupFile, analyzeStorage } from "../backup";
import { adminApi, ApiError } from "../api";
import MiniChart from "../components/MiniChart";
import ConfirmModal from "../components/ConfirmModal";

export default function DataManagement() {
  const { backupRuns, dbSize, refreshAll } = useAdmin();
  const [tab, setTab] = useState<"backup" | "restore" | "analysis">("backup");
  const [creating, setCreating] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [restoreFile, setRestoreFile] = useState<{ name: string; content: string } | null>(null);
  const [restoreVerifyMsg, setRestoreVerifyMsg] = useState("");
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purgeModule] = useState("main");

  async function handleCreateBackup() {
    setCreating(true);
    setBackupError("");
    try {
      // Server-side pg_dump run (202 → status "running" → "success" shortly after).
      await adminApi.runBackup();
      await refreshAll();
    } catch (e) {
      setBackupError(e instanceof ApiError ? e.message : "Backup failed");
    }
    setCreating(false);
  }

  async function handleSelectRestoreFile() {
    try {
      const content = await readBackupFile();
      const payload = JSON.parse(content);
      setRestoreFile({ name: "selected-backup.json", content });
      const keys = Object.keys(payload.data ?? {});
      setRestoreVerifyMsg(`Backup contains ${keys.length} keys, created ${payload.createdAt ?? "unknown"}`);
    } catch {
      setRestoreVerifyMsg("Failed to read backup file");
    }
  }

  async function handleRestore() {
    if (!restoreFile) return;
    try {
      await restoreBackup(restoreFile.content);
      setShowRestoreConfirm(false);
      setRestoreFile(null);
      refreshAll();
    } catch (e) {
      setRestoreVerifyMsg(e instanceof Error ? e.message : "Restore failed");
    }
  }

  function handlePurge() {
    const deleted: string[] = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)!;
      if (purgeModule === "all" || key.startsWith(purgeModule === "main" ? "" : `${purgeModule.slice(0, 3)}_`)) {
        if (key.startsWith("adm_")) continue;
        deleted.push(key);
      }
    }
    deleted.forEach((k) => localStorage.removeItem(k));
    setShowPurgeConfirm(false);
    refreshAll();
  }

  const btnStyle: React.CSSProperties = {
    padding: "0.5rem 1rem", background: "#00d4ff", border: "none", borderRadius: 6,
    color: "#0a0e1a", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
  const tabBtn = (t: typeof tab): React.CSSProperties => ({
    padding: "0.5rem 1rem", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer",
    fontFamily: "inherit", background: tab === t ? "#00d4ff" : "#0d1224",
    color: tab === t ? "#0a0e1a" : "#64748b", fontWeight: tab === t ? 600 : 400,
  });

  const statusColor: Record<string, string> = { success: "#00ff88", running: "#ffaa00", failed: "#ff4444" };
  const analysis = analyzeStorage();

  const dbSeries = dbSize ? dbSize.samples.map((s) => +(s.sizeBytes / 1024 / 1024).toFixed(2)) : [];
  const dbLatest = dbSize && dbSize.samples.length > 0 ? dbSize.samples[dbSize.samples.length - 1] : null;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 1.5rem", color: "#e2e8f0" }}>
        Data Management
      </h1>

      <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem" }}>
        <button style={tabBtn("backup")} onClick={() => setTab("backup")}>Backup</button>
        <button style={tabBtn("restore")} onClick={() => setTab("restore")}>Restore</button>
        <button style={tabBtn("analysis")} onClick={() => setTab("analysis")}>Analysis</button>
      </div>

      {tab === "backup" && (
        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 1rem", color: "#e2e8f0" }}>Create Backup</h2>
          <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 1rem", lineHeight: 1.5 }}>
            Triggers a server-side database backup (<code style={{ color: "#94a3b8" }}>pg_dump</code>). Restore is
            performed manually via <code style={{ color: "#94a3b8" }}>psql</code> by an operator — there is
            intentionally no restore endpoint.
          </p>
          <button onClick={handleCreateBackup} disabled={creating} style={{ ...btnStyle, opacity: creating ? 0.6 : 1 }}>
            {creating ? "Starting…" : "Create backup now"}
          </button>
          {backupError && (
            <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.3)", borderRadius: 6, fontSize: 12, color: "#ff4444" }}>
              {backupError}
            </div>
          )}

          <div style={{ marginTop: "1.5rem" }}>
            <h3 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Recent Backup Runs
            </h3>
            {backupRuns.length === 0 ? (
              <div style={{ fontSize: 12, color: "#475569" }}>No backup runs yet</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e2a3a" }}>
                    <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", color: "#64748b" }}>Started</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", color: "#64748b" }}>Size</th>
                    <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", color: "#64748b" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {backupRuns.map((b) => (
                    <tr key={b.id} style={{ borderBottom: "1px solid rgba(30,42,58,0.5)" }}>
                      <td style={{ padding: "0.4rem 0.5rem", color: "#cbd5e1" }}>
                        {new Date(b.startedAt).toLocaleString()}
                      </td>
                      <td style={{ padding: "0.4rem 0.5rem", color: "#94a3b8", textAlign: "right" }}>
                        {b.sizeBytes != null ? `${(b.sizeBytes / 1024 / 1024).toFixed(2)} MB` : "—"}
                      </td>
                      <td style={{ padding: "0.4rem 0.5rem", textAlign: "center", color: statusColor[b.status] ?? "#94a3b8", textTransform: "capitalize" }}>
                        {b.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ marginTop: "1.5rem" }}>
            <h3 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Database Size Trend
            </h3>
            {dbLatest ? (
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>
                    {(dbLatest.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                  {dbSize && (
                    <span style={{ fontSize: 11, color: dbSize.alertOver80 ? "#ff4444" : "#64748b" }}>
                      {((dbLatest.sizeBytes / dbSize.maxBytes) * 100).toFixed(0)}% of {(dbSize.maxBytes / 1024 / 1024 / 1024).toFixed(1)} GB budget
                    </span>
                  )}
                </div>
                {dbSeries.length > 1 && <MiniChart data={dbSeries} color="#8b5cf6" type="line" width={400} height={40} />}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#475569" }}>No database-size samples yet</div>
            )}
          </div>
        </div>
      )}

      {tab === "restore" && (
        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 1rem", color: "#e2e8f0" }}>Restore Local State</h2>
          <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 1rem", lineHeight: 1.5 }}>
            This restores a client-side localStorage snapshot for this browser only — it does <strong>not</strong>{" "}
            restore the server database. A server restore is a manual <code style={{ color: "#94a3b8" }}>psql</code>{" "}
            operation performed off-portal.
          </p>
          <button onClick={handleSelectRestoreFile} style={btnStyle}>
            {restoreFile ? "Change file…" : "Select backup file"}
          </button>
          {restoreVerifyMsg && (
            <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "rgba(0,212,255,0.1)", borderRadius: 6, fontSize: 12, color: "#00d4ff" }}>
              {restoreVerifyMsg}
            </div>
          )}
          {restoreFile && (
            <div style={{ marginTop: "1rem" }}>
              <div style={{ fontSize: 12, color: "#ff4444", marginBottom: "0.5rem", padding: "0.5rem", background: "rgba(255,68,68,0.1)", borderRadius: 6 }}>
                CAUTION: Restoring will overwrite all current localStorage data. This action cannot be undone.
              </div>
              <button onClick={() => setShowRestoreConfirm(true)} style={{ ...btnStyle, background: "#ff4444", color: "#fff" }}>
                Restore backup
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "analysis" && (
        <div>
          <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 1rem", color: "#e2e8f0" }}>localStorage Overview</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Total</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#e2e8f0" }}>
                  {(analysis.totalBytes / 1024 / 1024).toFixed(2)} MB
                </div>
                <div style={{ fontSize: 11, color: analysis.usedPercent > 80 ? "#ff4444" : "#94a3b8" }}>
                  {analysis.usedPercent.toFixed(0)}% of ~5 MB quota
                </div>
              </div>
              <div>
                {Object.entries(analysis.byModule).map(([mod, bytes]) => (
                  <div key={mod} style={{ marginBottom: 4, fontSize: 12, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ textTransform: "capitalize", color: "#94a3b8" }}>{mod}</span>
                    <span style={{ color: "#cbd5e1" }}>{(bytes / 1024).toFixed(1)} KB</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 0.75rem", color: "#e2e8f0" }}>All Keys</h2>
            <div style={{ overflowX: "auto", maxHeight: 300, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e2a3a" }}>
                    <th style={{ textAlign: "left", padding: "0.3rem 0.5rem", color: "#64748b" }}>Key</th>
                    <th style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: "#64748b" }}>Size</th>
                    <th style={{ textAlign: "center", padding: "0.3rem 0.5rem", color: "#64748b" }}>Module</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.largestKeys.map((k) => {
                    const mod = k.key.startsWith("adm_") ? "admin" : "main";
                    return (
                      <tr key={k.key} style={{ borderBottom: "1px solid rgba(30,42,58,0.5)" }}>
                        <td style={{ padding: "0.3rem 0.5rem", color: "#94a3b8", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {k.key}
                        </td>
                        <td style={{ padding: "0.3rem 0.5rem", color: "#cbd5e1", textAlign: "right" }}>{(k.sizeBytes / 1024).toFixed(1)} KB</td>
                        <td style={{ padding: "0.3rem 0.5rem", textAlign: "center", color: "#64748b", textTransform: "capitalize", fontSize: 11 }}>{mod}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowPurgeConfirm(true)} style={{ ...btnStyle, background: "#ffaa00", color: "#0a0e1a" }}>
              Purge old localStorage records
            </button>
          </div>
        </div>
      )}

      {showRestoreConfirm && (
        <ConfirmModal
          title="Restore Backup"
          message="This will overwrite ALL current localStorage data. This cannot be undone."
          confirmLabel="Restore"
          requireType="RESTORE"
          danger
          onConfirm={handleRestore}
          onCancel={() => setShowRestoreConfirm(false)}
        />
      )}

      {showPurgeConfirm && (
        <ConfirmModal
          title="Purge Old Records"
          message={`This will remove all records in "${purgeModule}" module (excluding admin data).`}
          confirmLabel="Purge"
          danger
          onConfirm={handlePurge}
          onCancel={() => setShowPurgeConfirm(false)}
        />
      )}
    </div>
  );
}
