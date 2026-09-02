import { useCallback, useEffect, useState } from "react";
import { adminApi, ApiError, type ReportOutputSettings } from "../api";
import {
  chooseFolder,
  forgetFolder,
  getStatus,
  reauthorize,
  resetPolicyCache,
  type FolderStatus,
} from "@/lib/reportFolder";

// Module 15b — where report PDFs go.
//
// Two destinations, deliberately shown as two separate cards because they have
// different reach and different failure modes:
//
//   1. CLIENT FOLDER — the operator's own PC. The on/off switch and subfolder
//      layout are central (DB), but the folder itself is picked per-PC: a browser
//      only ever yields an opaque directory handle, never a path, and the handle
//      cannot leave this browser profile. So this card has both a "policy" half
//      (syncs everywhere) and a "this PC" half (local only).
//   2. SERVER ARCHIVE — the API host's disk. A real absolute path, because the
//      server can honour one. Independent of the client folder.

const card: React.CSSProperties = {
  background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10,
  padding: "1.25rem", marginBottom: "1.5rem",
};
const h2: React.CSSProperties = {
  fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.25rem",
  textTransform: "uppercase", letterSpacing: "0.06em",
};
const hint: React.CSSProperties = { fontSize: 11, color: "#64748b", margin: "0 0 1rem", lineHeight: 1.6 };
const label: React.CSSProperties = { fontSize: 12, color: "#cbd5e1", display: "block", marginBottom: 6 };
const input: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.6rem", background: "#0d1224",
  border: "1px solid #1e2a3a", borderRadius: 6, color: "#e2e8f0",
  fontSize: 12, fontFamily: "inherit", boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  padding: "0.45rem 0.9rem", background: "#00d4ff14", border: "1px solid #00d4ff55",
  borderRadius: 6, color: "#00d4ff", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};
const btnMuted: React.CSSProperties = { ...btn, background: "transparent", border: "1px solid #1e2a3a", color: "#94a3b8" };
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: "0.75rem" };

export default function ReportOutput() {
  const [settings, setSettings] = useState<ReportOutputSettings | null>(null);
  const [envRoot, setEnvRoot] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderStatus | null>(null);
  const [archiveRootDraft, setArchiveRootDraft] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getReportOutputSettings();
      setSettings(res.settings);
      setEnvRoot(res.envArchiveRoot);
      setArchiveRootDraft(res.settings?.archiveRoot ?? "");
      setLabelDraft(res.settings?.folderLabel ?? "");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load settings");
    }
    setFolder(await getStatus());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function patch(body: Parameters<typeof adminApi.updateReportOutputSettings>[0]) {
    setErr(""); setMsg("");
    try {
      const res = await adminApi.updateReportOutputSettings(body);
      setSettings(res.settings);
      setArchiveRootDraft(res.settings.archiveRoot ?? "");
      setLabelDraft(res.settings.folderLabel ?? "");
      // So the next report on THIS page's tab re-reads the policy.
      resetPolicyCache();
      setMsg("Saved.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    }
  }

  if (loading) {
    return <div style={{ color: "#64748b", fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 0.35rem", color: "#e2e8f0" }}>
        Report Output
      </h1>
      <p style={{ ...hint, marginBottom: "1.5rem" }}>
        Where generated report PDFs are written. The client folder is per-PC; the server archive is one path on the API host.
      </p>

      {err && <div style={{ ...card, borderColor: "#7f1d1d", color: "#fca5a5", fontSize: 12 }}>{err}</div>}
      {msg && <div style={{ ...card, borderColor: "#14532d", color: "#86efac", fontSize: 12 }}>{msg}</div>}

      {/* ── 1. Client folder ─────────────────────────────────────────── */}
      <div style={card}>
        <h2 style={h2}>Client Folder (per PC)</h2>
        <p style={hint}>
          When on, report PDFs are written into a folder each PC chooses once, instead of the browser's
          Downloads folder. The switch and layout below apply to every PC; the folder itself must be
          picked locally — a browser never exposes a real path, so no path can be pushed from here.
        </p>

        <label style={{ ...row, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={settings?.clientFolderEnabled ?? false}
            onChange={(e) => void patch({ clientFolderEnabled: e.target.checked })}
          />
          <span style={{ fontSize: 12, color: "#cbd5e1" }}>
            Save reports to the chosen folder (all PCs)
          </span>
        </label>

        <label style={{ ...row, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={settings?.organizeSubfolders ?? true}
            onChange={(e) => void patch({ organizeSubfolders: e.target.checked })}
          />
          <span style={{ fontSize: 12, color: "#cbd5e1" }}>
            Organise into <code style={{ color: "#00d4ff" }}>year/month</code> subfolders
          </span>
        </label>

        <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
          <label style={label}>Folder name to use at every station (guidance only)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={input}
              value={labelDraft}
              placeholder="e.g. D:\SMT Reports"
              onChange={(e) => setLabelDraft(e.target.value)}
            />
            <button style={btn} onClick={() => void patch({ folderLabel: labelDraft })}>Save</button>
          </div>
          <p style={{ ...hint, marginTop: 6, marginBottom: 0 }}>
            Shown to whoever sets up each PC so every station picks the same folder. Not resolved as a path.
          </p>
        </div>

        <div style={{ borderTop: "1px solid #1e2a3a", paddingTop: "1rem" }}>
          <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            This PC
          </div>
          {folder?.supported === false ? (
            <p style={{ ...hint, color: "#fbbf24", margin: 0 }}>{folder.reason}</p>
          ) : (
            <>
              <p style={{ fontSize: 12, color: "#cbd5e1", margin: "0 0 0.5rem" }}>
                {folder?.configured
                  ? <>Folder: <strong style={{ color: "#00d4ff" }}>{folder.name}</strong>{folder.writable ? " — ready" : ""}</>
                  : "No folder chosen on this PC yet — reports go to Downloads."}
              </p>
              {folder?.reason && (
                <p style={{ ...hint, color: "#fbbf24", margin: "0 0 0.5rem" }}>{folder.reason}</p>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button style={btn} onClick={async () => setFolder(await chooseFolder())}>
                  {folder?.configured ? "Change folder" : "Choose folder"}
                </button>
                {folder?.configured && !folder.writable && (
                  <button style={btn} onClick={async () => setFolder(await reauthorize())}>Re-authorize</button>
                )}
                {folder?.configured && (
                  <button style={btnMuted} onClick={async () => setFolder(await forgetFolder())}>Forget</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── 2. Server archive ────────────────────────────────────────── */}
      <div style={card}>
        <h2 style={h2}>Server Archive</h2>
        <p style={hint}>
          A copy of every session report PDF, written on the API host as it is generated — same bytes the
          operator downloaded, plus a SHA-256 checksum, one file per session. This is the only copy that
          survives an operator clearing their Downloads folder. Client-generated PDFs (BOM, labels) are not
          archived; they never reach the server.
        </p>

        <label style={{ ...row, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={settings?.archiveEnabled ?? false}
            onChange={(e) => void patch({ archiveEnabled: e.target.checked })}
          />
          <span style={{ fontSize: 12, color: "#cbd5e1" }}>Archive every report on the server</span>
        </label>

        <div style={{ marginTop: "0.5rem" }}>
          <label style={label}>Archive root (absolute path on the API host)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={input}
              value={archiveRootDraft}
              placeholder="/var/lib/smtverification/reports"
              onChange={(e) => setArchiveRootDraft(e.target.value)}
            />
            <button style={btn} onClick={() => void patch({ archiveRoot: archiveRootDraft })}>Save</button>
          </div>
          <p style={{ ...hint, marginTop: 6, marginBottom: 0 }}>
            Files land in <code style={{ color: "#00d4ff" }}>&lt;root&gt;/year/month/session/</code>. The
            folder must exist and be writable by the API service. Prefer a second disk or a NAS mount:
            an archive on the database's own disk dies with it.
            {envRoot && (
              <> Currently also set in the environment as <code style={{ color: "#94a3b8" }}>{envRoot}</code> —
              the value above wins.</>
            )}
          </p>
        </div>

        {settings?.updatedAt && (
          <p style={{ ...hint, marginTop: "1rem", marginBottom: 0 }}>
            Last changed {new Date(settings.updatedAt).toLocaleString()}
            {settings.updatedBy ? ` by ${settings.updatedBy}` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
