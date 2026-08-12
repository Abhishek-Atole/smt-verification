export type AdminAuditAction =
  | "admin_login_success"
  | "admin_login_failed"
  | "admin_logout"
  | "admin_lockout"
  | "user_created"
  | "user_suspended"
  | "user_password_reset"
  | "user_role_changed"
  | "user_deleted"
  | "backup_created"
  | "backup_restored"
  | "data_exported"
  | "data_cleared"
  | "integrity_check_run"
  | "integrity_check_failed"
  | "session_force_logout"
  | "notification_broadcast"
  | "admin_password_changed"
  | "anomaly_detected";

export interface AuditEntry {
  id: string;
  timestamp: string;
  // Local logAudit() writes an AdminAuditAction; backend-sourced rows carry the
  // server AuditEvent name (e.g. USER_CREATED). Widened to string to hold both.
  action: string;
  actor: string;
  target?: string;
  details: string;
  outcome: "success" | "failure" | "warning";
  fingerprint?: string;
}

export interface SystemUser {
  id: string;
  name: string;
  email?: string;
  role: "operator" | "qa" | "supervisor" | "manager";
  createdAt: string;
  lastLoginAt?: string;
  suspended: boolean;
  suspendedReason?: string;
  passwordResetRequired: boolean;
  loginCount: number;
  failedLoginCount: number;
}

export interface StorageSnapshot {
  timestamp: string;
  keys: {
    key: string;
    sizeBytes: number;
    checksum: string;
    module: string;
  }[];
  totalBytes: number;
}

export interface BackupManifest {
  id: string;
  createdAt: string;
  createdBy: string;
  path: string;
  sizeBytes: number;
  checksum: string;
  keys: string[];
  verified: boolean;
  restoredAt?: string;
}

export interface DailyMetric {
  date: string;
  loginAttempts: number;
  loginSuccesses: number;
  loginFailures: number;
  scanEvents: number;
  exportEvents: number;
  activeUsers: number;
  storageUsedBytes: number;
  errorCount: number;
  avgResponseMs?: number;
}

export interface ActiveSession {
  userId: string;
  userName: string;
  role: string;
  loginAt: string;
  lastActiveAt: string;
  fingerprint: string;
}

export interface IntegrityResult {
  key: string;
  module: string;
  stored: string;
  current: string;
  match: boolean;
  changedAt?: string;
}

export interface SystemBroadcast {
  id: string;
  message: string;
  severity: "info" | "warning" | "critical";
  createdAt: string;
  expiresAt?: string;
  dismissible: boolean;
  readBy: string[];
}
