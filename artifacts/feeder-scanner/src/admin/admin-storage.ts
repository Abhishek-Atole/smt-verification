import type {
  AuditEntry,
  AdminAuditAction,
  BackupManifest,
  DailyMetric,
  SystemBroadcast,
  ActiveSession,
  StorageSnapshot,
} from "./admin-types";

const ADM_KEYS = {
  credential: "adm_credential",
  auditLog: "adm_audit_log",
  backups: "adm_backups",
  dailyMetrics: "adm_daily_metrics",
  integrityBaseline: "adm_integrity_baseline",
  broadcasts: "adm_broadcasts",
  activeSessions: "adm_active_sessions",
  auditArchive: "adm_audit_archive",
} as const;

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function nowFormatted(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${pad(d.getFullYear() % 100)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadAuditLog(): AuditEntry[] {
  return loadJSON<AuditEntry[]>(ADM_KEYS.auditLog, []);
}

export function saveAuditLog(v: AuditEntry[]): void {
  saveJSON(ADM_KEYS.auditLog, v);
}

export function appendAuditEntry(entry: Omit<AuditEntry, "id">): void {
  const log = loadAuditLog();
  const full: AuditEntry = { ...entry, id: makeId() };
  log.push(full);
  if (log.length > 10000) {
    const archive = loadJSON<AuditEntry[]>(ADM_KEYS.auditArchive, []);
    const cutoff = log.length - 5000;
    archive.push(...log.splice(0, cutoff));
    saveJSON(ADM_KEYS.auditArchive, archive);
  }
  saveAuditLog(log);
}

export function loadBackups(): BackupManifest[] {
  return loadJSON<BackupManifest[]>(ADM_KEYS.backups, []);
}

export function saveBackups(v: BackupManifest[]): void {
  saveJSON(ADM_KEYS.backups, v);
}

export function loadDailyMetrics(): DailyMetric[] {
  return loadJSON<DailyMetric[]>(ADM_KEYS.dailyMetrics, []);
}

export function saveDailyMetrics(v: DailyMetric[]): void {
  saveJSON(ADM_KEYS.dailyMetrics, v);
}

export function loadBroadcasts(): SystemBroadcast[] {
  return loadJSON<SystemBroadcast[]>(ADM_KEYS.broadcasts, []);
}

export function saveBroadcasts(v: SystemBroadcast[]): void {
  saveJSON(ADM_KEYS.broadcasts, v);
}

export function loadActiveSessions(): ActiveSession[] {
  return loadJSON<ActiveSession[]>(ADM_KEYS.activeSessions, []);
}

export function saveActiveSessions(v: ActiveSession[]): void {
  saveJSON(ADM_KEYS.activeSessions, v);
}

export function loadBaselineSnapshot(): StorageSnapshot | null {
  return loadJSON<StorageSnapshot | null>(ADM_KEYS.integrityBaseline, null);
}

export function saveBaselineSnapshot(snapshot: StorageSnapshot): void {
  saveJSON(ADM_KEYS.integrityBaseline, snapshot);
}

export function logAudit(
  action: AdminAuditAction,
  details: string,
  outcome: "success" | "failure" | "warning" = "success",
  target?: string,
): void {
  appendAuditEntry({
    timestamp: nowFormatted(),
    action,
    actor: "admin",
    target,
    details,
    outcome,
  });
}

export function recordDailyMetric(patch: Partial<DailyMetric>): void {
  const today = todayISO();
  const metrics = loadDailyMetrics();
  const idx = metrics.findIndex((m) => m.date === today);
  if (idx >= 0) {
    metrics[idx] = { ...metrics[idx], ...patch };
  } else {
    metrics.push({
      date: today,
      loginAttempts: 0,
      loginSuccesses: 0,
      loginFailures: 0,
      scanEvents: 0,
      exportEvents: 0,
      activeUsers: 0,
      storageUsedBytes: 0,
      errorCount: 0,
      ...patch,
    });
  }
  const trimmed = metrics.slice(-365);
  saveDailyMetrics(trimmed);
}

export function getAdminStorageKeys(): string[] {
  return Object.values(ADM_KEYS);
}

export { nowFormatted, todayISO, makeId };
