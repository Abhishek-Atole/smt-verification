// Module 15b — write report PDFs into a folder the admin chose, instead of the
// browser's default download directory.
//
// Why a handle and not a path: a web page cannot be given a filesystem path. The
// File System Access API only yields an opaque FileSystemDirectoryHandle, and
// only from a real user gesture (showDirectoryPicker). The handle is structured-
// cloneable, so it persists in IndexedDB — but it is scoped to this browser
// profile on this machine. It cannot be serialised to a path, sent to the server,
// or shared with another PC. That is why report_output_settings carries policy
// only and every PC picks its own folder once.
//
// Requirements, and what happens when they aren't met:
//   • Chromium-family browser (Chrome/Edge/Brave/Opera). Firefox and Safari have
//     not shipped showDirectoryPicker → isSupported() false.
//   • Secure context: https:// or http://localhost. A plain-HTTP LAN origin
//     (http://192.168.x.x) is NOT secure → the API is absent → unsupported.
//   In every unsupported/denied/error case saveReport() returns "download" and
//   the caller falls back to a normal browser download. Reports are never lost.

const DB_NAME = "smt_report_folder";
const STORE_NAME = "handles";
const HANDLE_KEY = "reportDir";

export type SaveOutcome = "folder" | "download";

export interface FolderStatus {
  supported: boolean;
  /** A handle is stored, but permission may still need re-granting. */
  configured: boolean;
  /** Write permission is granted right now — no prompt needed. */
  writable: boolean;
  /** Folder name the picker reported (e.g. "SMT Reports"). Not a path. */
  name: string | null;
  /** Why it can't be used, for display on the admin page. */
  reason: string | null;
}

export function isSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

function unsupportedReason(): string {
  if (typeof window === "undefined") return "No browser environment.";
  if (!window.isSecureContext) {
    return "This page is not a secure context. The folder picker needs https:// or http://localhost — " +
      "on a plain-HTTP LAN address the browser blocks it. Reports will go to the normal Downloads folder.";
  }
  return "This browser does not support the folder picker (Chrome, Edge, Brave or Opera required). " +
    "Reports will go to the normal Downloads folder.";
}

// ── IndexedDB handle storage ───────────────────────────────────────────────
// Bare IDB (no wrapper dep) — one object store, one key. localStorage cannot be
// used here: it only holds strings, and a directory handle is not serialisable.

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(): Promise<FileSystemDirectoryHandle | null> {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
        req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
        req.onerror = () => resolve(null);
      }),
  );
}

function idbPut(handle: FileSystemDirectoryHandle | null): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        if (handle) store.put(handle, HANDLE_KEY);
        else store.delete(HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      }),
  );
}

// ── Permissions ────────────────────────────────────────────────────────────
// A persisted handle survives a restart, but Chromium drops write permission
// between sessions. queryPermission() tells us without prompting;
// requestPermission() prompts and needs a user gesture.

async function hasWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

async function ensureWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (await hasWritePermission(handle)) return true;
  try {
    return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Current state, for the admin page. Never prompts. */
export async function getStatus(): Promise<FolderStatus> {
  if (!isSupported()) {
    return { supported: false, configured: false, writable: false, name: null, reason: unsupportedReason() };
  }
  const handle = await idbGet().catch(() => null);
  if (!handle) {
    return { supported: true, configured: false, writable: false, name: null, reason: null };
  }
  const writable = await hasWritePermission(handle);
  return {
    supported: true,
    configured: true,
    writable,
    name: handle.name,
    reason: writable ? null : "Permission needs re-granting — click Re-authorize (browsers drop it on restart).",
  };
}

/** Open the OS folder dialog. Must be called from a click handler. */
export async function chooseFolder(): Promise<FolderStatus> {
  const picker = typeof window !== "undefined" ? window.showDirectoryPicker : undefined;
  if (!picker) return getStatus();
  try {
    const handle = await picker.call(window, { id: "smt-reports", mode: "readwrite" });
    // Ask now, while we still have the gesture, so the first save doesn't prompt.
    if (!(await ensureWritePermission(handle))) {
      return { supported: true, configured: false, writable: false, name: handle.name,
        reason: "Write permission denied for that folder." };
    }
    await idbPut(handle);
    return { supported: true, configured: true, writable: true, name: handle.name, reason: null };
  } catch (err) {
    // AbortError = user closed the dialog; not a failure worth reporting.
    if (err instanceof DOMException && err.name === "AbortError") return getStatus();
    return { supported: true, configured: false, writable: false, name: null,
      reason: err instanceof Error ? err.message : "Could not open the folder picker." };
  }
}

/** Re-prompt for a stored handle whose permission lapsed. Needs a gesture. */
export async function reauthorize(): Promise<FolderStatus> {
  const handle = await idbGet().catch(() => null);
  if (!handle) return getStatus();
  await ensureWritePermission(handle);
  return getStatus();
}

export async function forgetFolder(): Promise<FolderStatus> {
  await idbPut(null).catch(() => undefined);
  return getStatus();
}

// ── Saving ─────────────────────────────────────────────────────────────────

function browserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late — Firefox can still be reading the blob when click() returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// <root>/<YYYY>/<MM>/ — mirrors the server archive layout so a folder holding a
// year of reports stays navigable. Off → everything lands flat in the root.
async function resolveTargetDir(
  root: FileSystemDirectoryHandle,
  organize: boolean,
): Promise<FileSystemDirectoryHandle> {
  if (!organize) return root;
  const now = new Date();
  const year = await root.getDirectoryHandle(String(now.getFullYear()), { create: true });
  return year.getDirectoryHandle(String(now.getMonth() + 1).padStart(2, "0"), { create: true });
}

/**
 * Write `blob` into the admin-chosen folder, falling back to a normal browser
 * download on any failure. Returns which path was taken so the caller can tell
 * the user where the file went.
 *
 * `organize` comes from the server policy (report_output_settings). Pass false
 * when the policy is off or unknown.
 *
 * Never throws: a report that can't reach the folder must still reach the user.
 */
export async function saveReport(
  blob: Blob,
  filename: string,
  organize: boolean,
): Promise<SaveOutcome> {
  if (!isSupported()) {
    browserDownload(blob, filename);
    return "download";
  }
  try {
    const root = await idbGet();
    if (!root || !(await hasWritePermission(root))) {
      browserDownload(blob, filename);
      return "download";
    }
    const dir = await resolveTargetDir(root, organize);
    const file = await dir.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return "folder";
  } catch {
    // Folder deleted, disk full, permission revoked mid-write — the user still
    // gets their report.
    browserDownload(blob, filename);
    return "download";
  }
}

// The policy is per-install and changes rarely, so one fetch per page load is
// plenty. A failed fetch means "folder off" — never block a download on it.
let policyPromise: Promise<{ enabled: boolean; organize: boolean }> | null = null;

function fetchPolicy(): Promise<{ enabled: boolean; organize: boolean }> {
  policyPromise ??= fetch("/api/report-output-settings", { credentials: "include" })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { settings?: { clientFolderEnabled?: boolean; organizeSubfolders?: boolean } } | null) => ({
      enabled: body?.settings?.clientFolderEnabled === true,
      organize: body?.settings?.organizeSubfolders !== false,
    }))
    .catch(() => ({ enabled: false, organize: false }));
  return policyPromise;
}

/** Call after the admin changes the policy so the next save re-reads it. */
export function resetPolicyCache(): void {
  policyPromise = null;
}

/**
 * What every report button should call. Reads the install policy, then either
 * writes into the chosen folder or does a normal download.
 */
export async function saveReportFile(blob: Blob, filename: string): Promise<SaveOutcome> {
  const policy = await fetchPolicy();
  if (!policy.enabled) {
    browserDownload(blob, filename);
    return "download";
  }
  return saveReport(blob, filename, policy.organize);
}

