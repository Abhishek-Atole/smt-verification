// Typed fetch client for the admin backend.
// All admin requests are same-origin (Express serves the SPA and the API),
// so credentials: 'include' just attaches the smt_admin_token cookie that
// /api/admin/auth/login set on path=/api/admin.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  // PRD §2.8 — every admin request carries X-Requested-With so the server
  // CSRF guard lets us through. The header is harmless on GETs but the
  // server only requires it on state-changing methods.
  const headers: Record<string, string> = { "X-Requested-With": "XMLHttpRequest" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const json = (await res.json()) as { error?: string; message?: string };
      detail = json.error ?? json.message ?? detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ─── Auth ────────────────────────────────────────────────────────────────
// `mustChange` is true for the seeded admin until they set a new username +
// password on first login (hard-gated server-side).
export interface AdminMe { adminId: string; username: string; mustChange?: boolean; }

export const adminApi = {
  login: (username: string, password: string) =>
    call<AdminMe>("POST", "/admin/auth/login", { username, password }),
  logout: () =>
    call<{ success: true }>("POST", "/admin/auth/logout"),
  me: () =>
    call<AdminMe>("GET", "/admin/auth/me"),
  changeCredentials: (input: { newUsername: string; currentPassword: string; newPassword: string }) =>
    call<AdminMe>("POST", "/admin/auth/change-credentials", input),

  // ─── Users ─────────────────────────────────────────────────────────────
  listUsers: () =>
    call<{ users: AdminUser[] }>("GET", "/admin/users"),
  createUser: (input: { name: string; employeeId: string; role: UserRole; password: string }) =>
    call<AdminUser>("POST", "/admin/users", input),
  updateUser: (id: string, patch: { name?: string; role?: UserRole; isActive?: boolean }) =>
    call<{ id: string }>("PATCH", `/admin/users/${id}`, patch),
  resetPassword: (id: string, password: string) =>
    call<{ id: string }>("POST", `/admin/users/${id}/reset-password`, { password }),
  deleteUser: (id: string) =>
    call<{ id: string }>("DELETE", `/admin/users/${id}`),

  // ─── Sessions / revocation (U17) ──────────────────────────────────────
  revokeUser: (userId: string) =>
    call<{ userId: string; revoked: true }>("DELETE", `/admin/sessions/${userId}`),

  // ─── Login activity ──────────────────────────────────────────────────
  loginEvents: (limit = 200) =>
    call<{ events: LoginEventRow[] }>("GET", `/admin/login-events?limit=${limit}`),

  // ─── Metrics (U16) ───────────────────────────────────────────────────
  metricsHistory: () =>
    call<{ samples: MetricSample[] }>("GET", "/admin/metrics/history"),
  metricsLatest: () =>
    call<{ sample: MetricSample | null }>("GET", "/admin/metrics/latest"),

  // ─── DB size trend (U18) ─────────────────────────────────────────────
  dbSize: () =>
    call<DbSizeResponse>("GET", "/admin/db-size"),

  // ─── Audit chain integrity (U6) ─────────────────────────────────────
  auditIntegrity: () =>
    call<{ total: number; brokenAt: { id: number; createdAt: string } | null }>("GET", "/admin/audit/integrity"),

  // ─── Audit log viewer ────────────────────────────────────────────────
  auditLogs: (limit = 200) =>
    call<{ logs: AuditLogRow[] }>("GET", `/admin/audit/logs?limit=${limit}`),

  // ─── Backups ─────────────────────────────────────────────────────────
  listBackups: () =>
    call<{ runs: BackupRunRow[] }>("GET", "/admin/backups"),
  runBackup: () =>
    call<BackupRunRow>("POST", "/admin/backups/run"),

  // ─── Access Control (Module 10) ──────────────────────────────────────
  listDevices: () =>
    call<{ devices: Device[] }>("GET", "/admin/devices"),
  createDevice: (input: { deviceType: DeviceType; deviceName: string; allowedIp: string; macAddress?: string; status?: DeviceStatus }) =>
    call<Device>("POST", "/admin/devices", input),
  updateDevice: (id: string, patch: { deviceType?: DeviceType; deviceName?: string; allowedIp?: string; macAddress?: string; status?: DeviceStatus }) =>
    call<Device>("PATCH", `/admin/devices/${id}`, patch),
  deleteDevice: (id: string) =>
    call<{ id: string }>("DELETE", `/admin/devices/${id}`),

  getSecuritySettings: () =>
    call<{ settings: SecuritySettings | null }>("GET", "/admin/security-settings"),
  updateSecuritySettings: (patch: { maintenanceMode?: boolean; failedAttemptThreshold?: number; sessionTimeoutEndDeviceSec?: number; sessionTimeoutStoreDeviceSec?: number; sessionTimeoutAdminDeviceSec?: number }) =>
    call<{ settings: SecuritySettings }>("PATCH", "/admin/security-settings", patch),

  activeSessions: () =>
    call<{ sessions: ActiveSession[] }>("GET", "/admin/active-sessions"),
  forceLogout: (userId: string) =>
    call<{ userId: string; revoked: boolean }>("POST", `/admin/active-sessions/${userId}/logout`),
};

export type UserRole = "operator" | "qa" | "supervisor" | "admin" | "storekeeper";

export interface AdminUser {
  id: string;
  name: string;
  role: UserRole;
  employeeId: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface LoginEventRow {
  id: string;
  userId: string | null;
  employeeId: string | null;
  ip: string | null;
  userAgent: string | null;
  result: "success" | "failure";
  failureReason: string | null;
  createdAt: string;
}

export interface MetricSample {
  ts: number;
  cpu: number;
  ramUsed: number;
  ramTotal: number;
  dbPoolTotal: number;
  dbPoolIdle: number;
  dbPoolWaiting: number;
}

export interface DbSizeResponse {
  samples: { date: string; sizeBytes: number; createdAt: string }[];
  maxBytes: number;
  alertOver80: boolean;
}

export interface BackupRunRow {
  id: string;
  scheduleId: string | null;
  triggeredBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "failed";
  filePath: string | null;
  sizeBytes: number | null;
  errorMessage: string | null;
}

export interface AuditLogRow {
  id: number;
  action: string;
  entityId: string | null;
  changedBy: string | null;
  description: string | null;
  createdAt: string;
}

// ─── Access Control (Module 10) ──────────────────────────────────────────
export type DeviceType = "end_device" | "admin_device" | "store_device" | "server";
export type DeviceStatus = "active" | "blocked" | "pending";

export interface Device {
  id: string;
  deviceType: DeviceType;
  deviceName: string;
  allowedIp: string;
  macAddress: string | null;
  status: DeviceStatus;
  createdBy: string | null;
  createdAt: string;
  lastModifiedBy: string | null;
  lastModifiedAt: string;
}

export interface SecuritySettings {
  id: boolean;
  maintenanceMode: boolean;
  failedAttemptThreshold: number;
  sessionTimeoutEndDeviceSec: number;
  sessionTimeoutStoreDeviceSec: number;
  sessionTimeoutAdminDeviceSec: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface ActiveSession {
  id: string;
  userId: string;
  userName: string;
  role: string;
  ip: string | null;
  userAgent: string | null;
  issuedAt: string;
  expiresAt: string;
  deviceType: string;
}
