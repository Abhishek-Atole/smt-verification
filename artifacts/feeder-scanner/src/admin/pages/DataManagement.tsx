import { useState, useEffect } from "react";
import { useAdmin } from "../admin-context";
import { restoreBackup, readBackupFile, analyzeStorage, exportLocalSnapshot } from "../backup";
import { adminApi, ApiError, type BackupStorage } from "../api";
import MiniChart from "../components/MiniChart";
import ConfirmModal from "../components/ConfirmModal";

// Data Management is split into two clearly-separated groups so a server
// database backup is never mistaken for a browser-local one:
//   1. SERVER DATABASE — pg_dump runs, storage health, download, guided restore.
//   2. THIS BROWSER (local only) — localStorage export/restore/analysis/purge.
// There is intentionally NO server restore endpoint (PRD §8) — restore is
// manual psql, which group 1 guides.

export default function DataManagement() {
  const { backupRuns, dbSize, refreshAll } = useAdmin();
  const [storage, setStorage] = useState<BackupStorage | null>(null);
  const [storageErr, setStorageErr] = useState("");

  const [creating, setCreating] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [restoreFile, setRestoreFile] = useState<{ name: string; content: string } | null>(null);
  const [restoreVerifyMsg, setRestoreVerifyMsg] = useState("");
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    adminApi.getBackupStorage()
      .then(setStorage)
      .catch(() => setStorageErr("Could not read backup storage status."));
  }, []);

  function report(e: unknown, fallback: string) {
    return e instanceof ApiError ? e.message : fallback;
  }

  async function handleCreateBackup() {
    setCreating(true);
    setBackupError("");
    try {
      await adminApi.runBackup();
      await refreshAll();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.message === "backup_dir_unset") {
        setBackupError("Cannot create a backup — BACKUP_DIR is not set on this server. Add it to the server .env and restart.");
      } else {
        setBackupError(report(e, "Backup failed"));
      }
    }
    setCreating(false);
  }

  async function handleDownload(id: string) {
    setBackupError("");
    try {
      const { blob, fileName } = await adminApi.downloadBackup(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setBackupError(report(e, "Download failed"));
    }
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
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)!;
      if (key.startsWith("adm_")) continue; // never purge admin integrity/baseline data
      localStorage.removeItem(key);
    }
    setShowPurgeConfirm(false);
    refreshAll();
  }

  async function copyPsql(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const btn: React.CSSProperties = {
    padding: "0.5rem 1rem", background: "#00d4ff", border: "none", borderRadius: 6,
    color: "#0a0e1a", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
  const btnDanger: React.CSSProperties = { ...btn, background: "#ff4444", color: "#fff" };
  const tiny: React.CSSProperties = {
    padding: "0.25rem 0.6rem", background: "transparent", border: "1px solid #1e2a3a",
    borderRadius: 5, color: "#94a3b8", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
  };
  const groupTitle: React.CSSProperties = {
    fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: "0 0 0.25rem",
  };
  const hint: React.CSSProperties = { fontSize: 12, color: "#64748b", margin: "0 0 1rem", lineHeight: 1.6 };

  const analysis = analyzeStorage();
  const dbSeries = dbSize ? dbSize.samples.map((s) => +(s.sizeBytes / 1024 / 1024).toFixed(2)) : [];
  const dbLatest = dbSize && dbSize.samples.length > 0 ? dbSize.samples[dbSize.samples.length - 1] : null;
  const statusColor: Record<string, string> = { success: "#00ff88", running: "#ffaa00", failed: "#ff4444" };

  // Newest successful snapshot (for the guided-restore example command).
  const latestGood = backupRuns.find((r) => r.status === "success" && r.filePath);

  function storageBanner() {
    const box = (bg: string, border: string, color: string, children: React.ReactNode) => (
      <div style={{ padding: "0.5rem 0.75rem", borderRadius: 6, background: bg, border: `1px solid ${border}`, color }}>
        {children}
      </div>
    );
    if (storageErr) return box("rgba(255,68,68,0.1)", "rgba(255,68,68,0.3)", "#ff4444", storageErr);
    if (!storage) return null;
    if (!storage.configured) {
      return box("rgba(255,68,68,0.1)", "rgba(255,68,68,0.3)", "#ff4444",
        <>Scheduled backups are <strong>OFF</strong> — <code>BACKUP_DIR</code> is not set on this server. Set it in the server .env (off the DB's disk) and restart to enable automatic backups.</>);
    }
    if (storage.sameDisk && !storage.allowSameDisk) {
      return box("rgba(255,68,68,0.1)", "rgba(255,68,68,0.3)", "#ff4444", storage.reason);
    }
    if (storage.sameDisk && storage.allowSameDisk) {
      return box("rgba(255,170,0,0.1)", "rgba(255,170,0,0.4)", "#ffaa00", storage.reason);
    }
    return box("rgba(0,255,136,0.08)", "rgba(0,255,136,0.3)", "#00ff88",
      <>Backups are configured and scheduled. Snapshot files land in <code style={{ color: "#00ff88" }}>{storage.dir}</code>.</>);
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 0.25rem", color: "#e2e8f0" }}>Data Management</h1>
      <p style={hint}>Two separate things live here — the server database backup and this browser's local state. They never mix.</p>

      {/* ─────────────────── 1. SERVER DATABASE ─────────────────────── */}
      <section style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem", marginBottom: "1.75rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2 style={{ ...groupTitle, color: "#00d4ff" }}>Server database</h2>
          <span style={{ fontSize: 11, color: "#64748b" }}>backups live on the API host</span>
        </div>

        <div style={{ margin: "0.75rem 0", fontSize: 12, lineHeight: 1.6 }}>{storageBanner()}</div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
          <button onClick={handleCreateBackup} disabled={creating} style={{ ...btn, opacity: creating ? 0.6 : 1 }}>
            {creating ? "Starting…" : "Create backup now"}
          </button>
          {storage && storage.configured && (
            <span style={{ fontSize: 11, color: "#64748b" }}>
              Keep {storage.retentionDays} days · next scheduled ~{" "}
              {storage.nextScheduledAt ? new Date(storage.nextScheduledAt).toLocaleString() : "—"}
            </span>
          )}
        </div>

        {backupError && (
          <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.3)", borderRadius: 6, fontSize: 12, color: "#ff4444" }}>
            {backupError}
          </div>
        )}

        {backupRuns.length === 0 ? (
          <div style={{ fontSize: 12, color: "#475569", marginBottom: "1rem" }}>No backup runs yet.</div>
        ) : (
          <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e2a3a" }}>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", color: "#64748b" }}>Started</th>
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", color: "#64748b" }}>Finished</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", color: "#64748b" }}>Size</th>
                  <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", color: "#64748b" }}>Status</th>
                  <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", color: "#64748b" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {backupRuns.map((b) => (
                  <tr key={b.id} style={{ borderBottom: "1px solid rgba(30,42,58,0.5)" }}>
                    <td style={{ padding: "0.4rem 0.5rem", color: "#cbd5e1", whiteSpace: "nowrap" }}>{new Date(b.startedAt).toLocaleString()}</td>
                    <td style={{ padding: "0.4rem 0.5rem", color: "#94a3b8", fontSize: 11, whiteSpace: "nowrap" }}>{b.finishedAt ? new Date(b.finishedAt).toLocaleString() : "—"}</td>
                    <td style={{ padding: "0.4rem 0.5rem", color: "#94a3b8", textAlign: "right" }}>{b.sizeBytes != null ? `${(b.sizeBytes / 1024 / 1024).toFixed(2)} MB` : "—"}</td>
                    <td style={{ padding: "0.4rem 0.5rem", textAlign: "center", color: statusColor[b.status] ?? "#94a3b8", textTransform: "capitalize" }}>{b.status}</td>
                    <td style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                      {b.status === "success" ? (
                        <button style={{ ...tiny, color: "#00d4ff" }} onClick={() => handleDownload(b.id)} title="Download the .sql to copy it off this machine (NAS/USB)">
                          Download
                        </button>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dbLatest && (
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>{(dbLatest.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
              {dbSize && (
                <span style={{ fontSize: 11, color: dbSize.alertOver80 ? "#ff4444" : "#64748b" }}>
                  {((dbLatest.sizeBytes / dbSize.maxBytes) * 100).toFixed(0)}% of {(dbSize.maxBytes / 1024 / 1024 / 1024).toFixed(1)} GB budget
                </span>
              )}
            </div>
            {dbSeries.length > 1 && <MiniChart data={dbSeries} color="#8b5cf6" type="line" width={400} height={40} />}
          </div>
        )}

        <details style={{ fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: "#00d4ff", padding: "0.25rem 0" }}>How to restore the database (manual — no endpoint)</summary>
          <div style={{ color: "#94a3b8", marginTop: "0.5rem", lineHeight: 1.7 }}>
            Restoring replaces the whole database, so it is a deliberate, off-portal step. On the API host:
            <ol style={{ margin: "0.5rem 0", paddingLeft: "1.25rem" }}>
              <li>Stop the app so nothing writes mid-restore: <code>sudo systemctl stop smt-verification</code></li>
              <li>Restore into a <strong>fresh</strong> database first (recommended), then point <code>DATABASE_URL</code> at it:
                <pre style={{ background: "#0d1224", padding: "0.5rem", borderRadius: 6, overflowX: "auto", whiteSpace: "pre-wrap" }}>
{`createdb -O <app_user> smtverification_restore
psql "postgres://<app_user>@localhost/smtverification_restore" -f "${storage?.dir ?? "<BACKUP_DIR>"}/${latestGood?.filePath ? latestGood.filePath.split("/").pop() : "backup-<timestamp>.sql"}"`}
                </pre>
              </li>
              <li>Or restore in place by wiping the schema first:
                <pre style={{ background: "#0d1224", padding: "0.5rem", borderRadius: 6, overflowX: "auto", whiteSpace: "pre-wrap" }}>
{`psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
psql "$DATABASE_URL" -f "${storage?.dir ?? "<BACKUP_DIR>"}/${latestGood?.filePath ? latestGood.filePath.split("/").pop() : "backup-<timestamp>.sql"}"`}
                </pre>
              </li>
              <li>Start the app and verify: <code>sudo systemctl start smt-verification</code>, then run the Audit Log Integrity check.</li>
            </ol>
            <button style={tiny} onClick={() => copyPsql(`psql "$DATABASE_URL" -f "${storage?.dir ?? "<BACKUP_DIR>"}/${latestGood?.filePath ? latestGood.filePath.split("/").pop() : "backup-<timestamp>.sql"}"`)}>
              {copied ? "Copied ✓" : "Copy restore command"}
            </button>
          </div>
        </details>
      </section>

      {/* ─────────────────── 2. THIS BROWSER (LOCAL ONLY) ─────────────────────── */}
      <section style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2 style={{ ...groupTitle, color: "#ffaa00" }}>This browser (local only)</h2>
          <span style={{ fontSize: 11, color: "#64748b" }}>localStorage — does NOT touch the server database</span>
        </div>
        <p style={hint}>
          A snapshot of this browser's Admin state (audit entries, integrity baseline). It is not a database backup —
          it only survives to move that state to another browser on this machine.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "1rem" }}>
          <button style={btn} onClick={exportLocalSnapshot}>Download local snapshot</button>
          <button style={btn} onClick={handleSelectRestoreFile}>
            {restoreFile ? "Change file…" : "Restore from snapshot"}
          </button>
        </div>

        {restoreVerifyMsg && (
          <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "rgba(0,212,255,0.1)", borderRadius: 6, fontSize: 12, color: "#00d4ff" }}>
            {restoreVerifyMsg}
          </div>
        )}
        {restoreFile && (
          <div style={{ marginBottom: "1rem", fontSize: 12, color: "#cbd5e1" }}>
            <div style={{ marginBottom: "0.5rem", padding: "0.5rem", background: "rgba(255,68,68,0.1)", borderRadius: 6, color: "#ff4444" }}>
              CAUTION: Restoring overwrites all current localStorage data on this browser. This cannot be undone.
            </div>
            <button style={btnDanger} onClick={() => setShowRestoreConfirm(true)}>Restore backup</button>
          </div>
        )}

        <div style={{ borderTop: "1px solid #1e2a3a", paddingTop: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: "#64748b" }}>localStorage used</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: analysis.usedPercent > 80 ? "#ff4444" : "#e2e8f0" }}>
              {(analysis.totalBytes / 1024 / 1024).toFixed(2)} MB
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{analysis.usedPercent.toFixed(0)}% of ~5 MB quota</div>
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

        {analysis.largestKeys.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: "1rem", maxHeight: 180, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <tbody>
                {analysis.largestKeys.map((k) => (
                  <tr key={k.key} style={{ borderBottom: "1px solid rgba(30,42,58,0.5)" }}>
                    <td style={{ padding: "0.25rem 0.5rem", color: "#94a3b8", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.key}</td>
                    <td style={{ padding: "0.25rem 0.5rem", color: "#cbd5e1", textAlign: "right" }}>{(k.sizeBytes / 1024).toFixed(1)} KB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: "1rem" }}>
          <button style={{ ...btn, background: "#ffaa00", color: "#0a0e1a" }} onClick={() => setShowPurgeConfirm(true)}>
            Purge local records (non-admin)
          </button>
        </div>
      </section>

      {showRestoreConfirm && (
        <ConfirmModal
          title="Restore Local Snapshot"
          message="This overwrites ALL current localStorage data in this browser. It cannot be undone."
          confirmLabel="Restore"
          requireType="RESTORE"
          danger
          onConfirm={handleRestore}
          onCancel={() => setShowRestoreConfirm(false)}
        />
      )}

      {showPurgeConfirm && (
        <ConfirmModal
          title="Purge Local Records"
          message="This removes all non-admin localStorage records in this browser (admin integrity/baseline data is kept)."
          confirmLabel="Purge"
          danger
          onConfirm={handlePurge}
          onCancel={() => setShowPurgeConfirm(false)}
        />
      )}
    </div>
  );
}
