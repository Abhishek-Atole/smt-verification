type AuditEvent =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILURE"
  | "LOGOUT"
  | "SCAN_VERIFIED"
  | "SCAN_REJECTED"
  | "SCAN_DUPLICATE"
  | "SESSION_STARTED"
  | "SESSION_COMPLETED"
  | "SPLICE_RECORDED"
  | "UNAUTHORIZED_ACCESS"
  | "BOM_IMPORTED"
  | "BOM_CREATED"
  | "BOM_UPDATED"
  | "BOM_DELETED"
  | "BOM_RESTORED"
  | "BOM_PERMANENTLY_DELETED"
  | "BOM_LOCKED"
  | "BOM_RELEASED"
  | "BOM_HELD"
  | "PASTE_JAR_CREATED"
  | "PASTE_JAR_UPDATED"
  | "PASTE_JAR_DELETED"
  | "PASTE_JAR_ALLOCATED"
  | "PASTE_JAR_RETURNED"
  | "PASTE_JAR_STAGE_SCAN"
  | "SESSION_MARKED_INCOMPLETE"
  | "SECURITY_ACCOUNT_LOCKED"
  | "SECURITY_ADMIN_LOCKED"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_PASSWORD_RESET"
  | "USER_DELETED"
  | "ADMIN_CREDENTIALS_CHANGED"
  | "SESSION_REVOKED"
  // Module 10 — device / IP restriction & security settings
  | "SECURITY_DEVICE_BLOCKED"
  | "SECURITY_DEVICE_LOOKUP_UNAVAILABLE"
  | "SECURITY_ORIGIN_REJECTED"
  | "SECURITY_MAINTENANCE_BLOCK"
  | "SECURITY_LOGIN_DEVICE_MISMATCH"
  | "DEVICE_CREATED"
  | "DEVICE_UPDATED"
  | "DEVICE_DELETED"
  | "SECURITY_SETTINGS_UPDATED"
  // Module 12.3 — database backup run + retention prune audit trail
  | "BACKUP_STARTED"
  | "BACKUP_SUCCEEDED"
  | "BACKUP_FAILED"
  | "BACKUP_PRUNED"
  // Module 14 — admin notification broadcast
  | "NOTIFICATION_BROADCAST"
  // Module 15b — report output destinations (client folder policy + archive root)
  | "REPORT_OUTPUT_SETTINGS_UPDATED";

import crypto from "node:crypto";
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";
import { logger } from "./logger";
import { TimestampService } from "../services/timestamp-service";

// U6 — HMAC-SHA256 chain hash for audit log integrity.
// chain_hash(N) = HMAC(secret, prev_hash || canonical(row))
// Genesis row uses prev_hash = "" (empty string). Verifier recomputes the chain.

const GENESIS_PREV = "";
let chainPromise: Promise<string> = (async () => {
  try {
    const [last] = await db.select({ chainHash: auditLogsTable.chainHash })
      .from(auditLogsTable)
      .where(isNotNull(auditLogsTable.chainHash))
      .orderBy(desc(auditLogsTable.id))
      .limit(1);
    return last?.chainHash ?? GENESIS_PREV;
  } catch {
    return GENESIS_PREV;
  }
})();

function canonicalize(row: {
  entityType: string;
  entityId: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string | null;
  description: string | null;
  createdAt: Date | string;
}): string {
  // Stable key order — never reorder; downstream verifiers depend on this exact layout.
  const createdAtIso = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
  return JSON.stringify({
    entityType:  row.entityType,
    entityId:    row.entityId,
    action:      row.action,
    oldValue:    row.oldValue,
    newValue:    row.newValue,
    changedBy:   row.changedBy,
    description: row.description,
    createdAt:   createdAtIso,
  });
}

export function computeChainHash(prevHash: string, canonical: string): string {
  const secret = process.env.AUDIT_HMAC_SECRET;
  if (!secret) throw new Error("AUDIT_HMAC_SECRET must be set");
  return crypto.createHmac("sha256", secret).update(prevHash + canonical).digest("hex");
}

interface AuditLog {
  event: AuditEvent;
  operatorId?: string;
  sessionId?: string;
  detail?: string;
  ip?: string;
  timestamp: string;
}

export async function auditLog(entry: Omit<AuditLog, "timestamp">) {
  const log: AuditLog = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  // Serialize chain extension through chainPromise so concurrent inserts
  // cannot interleave and produce two rows with the same prev_hash.
  const previous = chainPromise;
  chainPromise = (async () => {
    const prev = await previous.catch(() => GENESIS_PREV);
    const createdAt = TimestampService.createAuditTimestamp();
    const row = {
      entityType: "security_event",
      entityId: log.sessionId != null ? String(log.sessionId) : log.event,
      action: log.event,
      oldValue: null,
      newValue: JSON.stringify({
        detail: log.detail ?? null,
        ip: log.ip ?? null,
        timestamp: log.timestamp,
      }),
      changedBy: log.operatorId != null ? String(log.operatorId) : null,
      description: log.detail ?? log.event,
      createdAt,
    };
    let chainHash = prev;
    try {
      chainHash = computeChainHash(prev, canonicalize(row));
      await db.insert(auditLogsTable).values({ ...row, chainHash });
    } catch (error) {
      logger.warn({ err: error }, "Failed to persist audit event");
      // On failure, keep previous chain head so the next event chains from
      // the last successfully-inserted row (not from a row that never landed).
      return prev;
    }
    return chainHash;
  })();

  // Surface the chain failure to the caller's log but never throw — audit
  // logging must not break the request path.
  chainPromise.catch(() => undefined);

  logger.info({ audit: true, ...log }, "Audit event recorded");
}

export interface AuditChainCheckResult {
  total: number;
  brokenAt: { id: number; createdAt: string } | null;
}

/**
 * Verify the audit_logs chain by recomputing each row's HMAC and comparing
 * to the stored chain_hash. Returns the first row whose chain_hash does not
 * match (broken integrity) or null if every row checks out.
 *
 * Rows with NULL chain_hash (pre-Phase-1 backfill gap) are skipped, but the
 * walker still chains forward so the next row's prev is the last good hash.
 */
export async function verifyAuditChain(): Promise<AuditChainCheckResult> {
  const rows = await db.select({
    id: auditLogsTable.id,
    entityType: auditLogsTable.entityType,
    entityId: auditLogsTable.entityId,
    action: auditLogsTable.action,
    oldValue: auditLogsTable.oldValue,
    newValue: auditLogsTable.newValue,
    changedBy: auditLogsTable.changedBy,
    description: auditLogsTable.description,
    chainHash: auditLogsTable.chainHash,
    createdAt: auditLogsTable.createdAt,
  })
    .from(auditLogsTable)
    .orderBy(auditLogsTable.id);

  let prev = GENESIS_PREV;
  for (const row of rows) {
    if (row.chainHash == null) {
      continue; // unchained legacy row — skip but don't advance prev
    }
    const expected = computeChainHash(prev, canonicalize({
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      oldValue: row.oldValue,
      newValue: row.newValue,
      changedBy: row.changedBy,
      description: row.description,
      createdAt: row.createdAt,
    }));
    if (expected !== row.chainHash) {
      return {
        total: rows.length,
        brokenAt: { id: row.id, createdAt: (row.createdAt as Date).toISOString() },
      };
    }
    prev = row.chainHash;
  }
  return { total: rows.length, brokenAt: null };
}