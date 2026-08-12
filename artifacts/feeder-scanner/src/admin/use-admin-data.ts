import { useState, useEffect, useCallback } from "react";
import type { AuditEntry, DailyMetric, SystemBroadcast } from "./admin-types";
import {
  loadDailyMetrics, loadBroadcasts, saveBroadcasts,
  nowFormatted, makeId,
} from "./admin-storage";
import { analyzeStorage } from "./backup";
import {
  adminApi,
  type AdminUser, type LoginEventRow, type MetricSample,
  type DbSizeResponse, type BackupRunRow, type AuditLogRow,
} from "./api";

export interface AuditIntegrity {
  total: number;
  brokenAt: { id: number; createdAt: string } | null;
}

export interface AdminDataState {
  ready: boolean;
  // ── backend-sourced (adminApi) ──
  users: AdminUser[];
  auditLog: AuditEntry[];
  loginEvents: LoginEventRow[];
  metricsLatest: MetricSample | null;
  metricsHistory: MetricSample[];
  dbSize: DbSizeResponse | null;
  backupRuns: BackupRunRow[];
  auditIntegrity: AuditIntegrity | null;
  // ── local-only (no backend source yet) ──
  dailyMetrics: DailyMetric[];
  broadcasts: SystemBroadcast[];
  storageAnalysis: ReturnType<typeof analyzeStorage> | null;
}

const EMPTY: AdminDataState = {
  ready: false,
  users: [],
  auditLog: [],
  loginEvents: [],
  metricsLatest: null,
  metricsHistory: [],
  dbSize: null,
  backupRuns: [],
  auditIntegrity: null,
  dailyMetrics: [],
  broadcasts: [],
  storageAnalysis: null,
};

// Backend AuditEvent names that represent a failed/denied action. Everything
// else maps to a "success" outcome for the ActivityFeed colour coding.
const FAILURE_ACTION = /UNAUTHORIZED|DENIED|_FAIL|FAILED|LOCKED|REJECT|INVALID/i;
const WARNING_ACTION = /^SECURITY_|DELETED|REVOKED/i;

// The ActivityFeed component splits the timestamp on " " to show the time part,
// so backend ISO strings must be reformatted to "DD/MM/YY HH:MM:SS" (a space
// separator), matching what the local logAudit() used to write.
function fmtTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${pad(d.getFullYear() % 100)} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function outcomeFor(action: string): AuditEntry["outcome"] {
  if (FAILURE_ACTION.test(action)) return "failure";
  if (WARNING_ACTION.test(action)) return "warning";
  return "success";
}

function mapAuditRow(r: AuditLogRow): AuditEntry {
  return {
    id: String(r.id),
    timestamp: fmtTs(r.createdAt),
    action: r.action,
    actor: r.changedBy ?? "system",
    target: r.entityId ?? undefined,
    details: r.description ?? "",
    outcome: outcomeFor(r.action),
  };
}

export function useAdminData() {
  const [state, setState] = useState<AdminDataState>(EMPTY);

  const loadAll = useCallback(async () => {
    // Fetch every backend slice in parallel. Each falls back to an empty/null
    // value on error so one failing endpoint can't blank the whole dashboard.
    const [
      users, auditLog, loginEvents, metricsLatest, metricsHistory,
      dbSize, backupRuns, auditIntegrity,
    ] = await Promise.all([
      adminApi.listUsers().then((r) => r.users).catch(() => [] as AdminUser[]),
      adminApi.auditLogs().then((r) => r.logs.map(mapAuditRow)).catch(() => [] as AuditEntry[]),
      adminApi.loginEvents().then((r) => r.events).catch(() => [] as LoginEventRow[]),
      adminApi.metricsLatest().then((r) => r.sample).catch(() => null),
      adminApi.metricsHistory().then((r) => r.samples).catch(() => [] as MetricSample[]),
      adminApi.dbSize().catch(() => null),
      adminApi.listBackups().then((r) => r.runs).catch(() => [] as BackupRunRow[]),
      adminApi.auditIntegrity().catch(() => null),
    ]);

    setState({
      ready: true,
      users,
      auditLog,
      loginEvents,
      metricsLatest,
      metricsHistory,
      dbSize,
      backupRuns,
      auditIntegrity,
      dailyMetrics: loadDailyMetrics(),
      broadcasts: loadBroadcasts(),
      storageAnalysis: analyzeStorage(),
    });
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const storageTimer = setInterval(() => {
      setState((s) => ({ ...s, storageAnalysis: analyzeStorage() }));
    }, 30000);
    return () => clearInterval(storageTimer);
  }, []);

  const refreshAll = useCallback(() => loadAll(), [loadAll]);

  const refreshStorage = useCallback(() => {
    setState((s) => ({ ...s, storageAnalysis: analyzeStorage() }));
  }, []);

  const addBroadcast = useCallback((message: string, severity: "info" | "warning" | "critical", expiresAt?: string, dismissible = true) => {
    const broadcast: SystemBroadcast = {
      id: makeId(),
      message,
      severity,
      createdAt: nowFormatted(),
      expiresAt,
      dismissible,
      readBy: [],
    };
    const broadcasts = loadBroadcasts();
    broadcasts.push(broadcast);
    saveBroadcasts(broadcasts);
    setState((s) => ({ ...s, broadcasts }));
  }, []);

  const removeBroadcast = useCallback((id: string) => {
    const broadcasts = loadBroadcasts().filter((b) => b.id !== id);
    saveBroadcasts(broadcasts);
    setState((s) => ({ ...s, broadcasts }));
  }, []);

  return {
    ...state,
    refreshAll,
    refreshStorage,
    addBroadcast,
    removeBroadcast,
  };
}
