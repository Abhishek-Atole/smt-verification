import { spawn } from "node:child_process";
import { mkdir, stat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { backupRunsTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { auditLog } from "../lib/auditLogger";

// Backup service uses pg_dump to write a plain-SQL file into BACKUP_DIR.
// On success, the row's status flips to 'success' and file_path/size_bytes are filled.
// On failure, status='failed' with error_message captured.
//
// Restore is intentionally NOT exposed via API (per PRD §8 — manual psql only).
//
// Module 12 hardening (2026-08-30):
//   • BACKUP_DIR has NO implicit ./backups default — an unset value is a hard
//     error, because ./backups sits on the same disk as the live DB (spec §12.1).
//   • verifyBackupStorage() refuses to schedule backups when BACKUP_DIR resolves
//     to the same physical disk as the Postgres data directory, unless the
//     operator sets BACKUP_ALLOW_SAME_DISK=true (which only downgrades to a warn).
//   • pruneOldBackups() never deletes the most-recent successful snapshot (§12.2).
//   • Every run (start/success/failure) and every prune deletion is audit-logged (§12.3).

function backupDir(): string {
  const dir = process.env.BACKUP_DIR;
  if (!dir || !dir.trim()) {
    // No silent ./backups fallback: that would put snapshots on the same disk
    // as the DB they are meant to survive. Force an explicit, off-disk path.
    throw new Error("BACKUP_DIR must be set (no implicit ./backups; backups must live off the DB's disk)");
  }
  return dir;
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  return url;
}

// Ask Postgres where its data directory lives so we can compare physical disks.
// Requires the connecting role to see `data_directory` (superuser or granted);
// on any error we return null and the caller treats the disk as unverifiable.
async function dbDataDirectory(): Promise<string | null> {
  try {
    const result = await db.execute<{ data_directory: string }>(sql`SHOW data_directory`);
    const rows = (result as unknown as { rows?: Array<{ data_directory?: string }> }).rows ?? [];
    return rows[0]?.data_directory ?? null;
  } catch {
    return null;
  }
}

export interface BackupStorageCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Startup guard (spec §12.1). Verifies BACKUP_DIR is set and does not sit on the
 * same physical disk as the Postgres data directory. Returns { ok:false } (and
 * logs loudly) when misconfigured so the caller can refuse to schedule backups —
 * the app keeps running, but we never silently write snapshots to a disk whose
 * failure would take the backups down with the DB.
 *
 * BACKUP_ALLOW_SAME_DISK=true is an explicit escape hatch (single-disk clients):
 * it downgrades the same-disk block to a warning but still lets backups run.
 */
export async function verifyBackupStorage(): Promise<BackupStorageCheck> {
  let dir: string;
  try {
    dir = backupDir();
  } catch (err) {
    logger.error({ err }, "BACKUP_DIR is not configured — scheduled backups DISABLED");
    return { ok: false, reason: "BACKUP_DIR unset" };
  }

  await mkdir(dir, { recursive: true }).catch(() => undefined);

  const allowSameDisk = process.env.BACKUP_ALLOW_SAME_DISK === "true";
  const dataDir = await dbDataDirectory();
  if (!dataDir) {
    // Remote DB or insufficient privilege to read data_directory — cannot prove
    // same-disk. Treat as off-disk (safe) but note it for the operator.
    logger.info({ backupDir: dir }, "Could not resolve DB data directory; skipping same-disk backup check");
    return { ok: true };
  }

  const [backupStat, dataStat] = await Promise.all([
    stat(dir).catch(() => null),
    stat(dataDir).catch(() => null),
  ]);
  // If the DB data dir is not locally visible (e.g. DB on another host), its
  // stat fails → different disk by definition. Same-disk only when both resolve
  // to the same device id.
  const sameDisk =
    backupStat != null && dataStat != null && backupStat.dev === dataStat.dev;

  if (sameDisk && !allowSameDisk) {
    logger.error(
      { backupDir: dir, dataDir },
      "BACKUP_DIR is on the SAME physical disk as the Postgres data directory — scheduled backups DISABLED. " +
        "Point BACKUP_DIR at a second disk / NAS / cloud mount, or set BACKUP_ALLOW_SAME_DISK=true to override.",
    );
    return { ok: false, reason: "BACKUP_DIR on same disk as DB" };
  }
  if (sameDisk && allowSameDisk) {
    logger.warn(
      { backupDir: dir, dataDir },
      "BACKUP_DIR is on the same disk as the DB but BACKUP_ALLOW_SAME_DISK=true — proceeding. " +
        "This protects against corruption but NOT disk failure; move backups off-disk when possible.",
    );
  }
  return { ok: true };
}

// Exported for tests — the retention floor (§12.2) is the critical invariant
// and is covered directly rather than through the pg_dump-driven happy path.
export async function pruneOldBackups(retentionDays: number): Promise<void> {
  if (retentionDays <= 0) return;
  const dir = backupDir();

  // Retention floor (spec §12.2): never delete the most-recent successful
  // snapshot, even if the retention window would otherwise remove it — there
  // must always be at least one restorable backup on disk.
  let protectedPath: string | null = null;
  try {
    const [latest] = await db
      .select({ filePath: backupRunsTable.filePath })
      .from(backupRunsTable)
      .where(eq(backupRunsTable.status, "success"))
      .orderBy(desc(backupRunsTable.finishedAt))
      .limit(1);
    protectedPath = latest?.filePath ? path.resolve(latest.filePath) : null;
  } catch (err) {
    // If we cannot determine the newest good backup, prune nothing rather than
    // risk deleting the only restorable snapshot.
    logger.warn({ err }, "backup prune skipped — could not resolve latest successful backup");
    return;
  }

  try {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.startsWith("backup-") || !f.endsWith(".sql")) continue;
      const full = path.join(dir, f);
      if (protectedPath && path.resolve(full) === protectedPath) continue; // retention floor
      const st = await stat(full).catch(() => null);
      if (st && st.mtimeMs < cutoff) {
        try {
          await unlink(full);
          void auditLog({ event: "BACKUP_PRUNED", detail: `Pruned expired backup ${f} (retention ${retentionDays}d)` });
        } catch {
          /* best-effort; a failed unlink just leaves the file for the next run */
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "backup prune failed");
  }
}

export interface BackupRunResult {
  id: string;
  status: "running" | "success" | "failed";
  filePath: string | null;
  sizeBytes: number | null;
}

export async function runBackupNow(input: { triggeredBy?: string } = {}): Promise<BackupRunResult> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `backup-${stamp}.sql`);

  const [run] = await db.insert(backupRunsTable).values({
    triggeredBy: input.triggeredBy,
    status: "running",
  }).returning({ id: backupRunsTable.id });

  void auditLog({
    event: "BACKUP_STARTED",
    operatorId: input.triggeredBy,
    detail: `Backup started (${input.triggeredBy ? "manual" : "scheduled"}) → ${file}`,
  });

  // Fire pg_dump asynchronously; the API returns 202 immediately and the row
  // is updated when the child exits.
  void executeDump(run.id, file).then(async (result) => {
    await db.update(backupRunsTable).set({
      status: result.ok ? "success" : "failed",
      filePath: result.ok ? file : null,
      sizeBytes: result.ok ? result.sizeBytes : null,
      finishedAt: new Date(),
      errorMessage: result.ok ? null : result.error,
    }).where(eq(backupRunsTable.id, run.id));
    if (result.ok) {
      void auditLog({
        event: "BACKUP_SUCCEEDED",
        operatorId: input.triggeredBy,
        detail: `Backup succeeded → ${file} (${result.sizeBytes} bytes)`,
      });
      const retention = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
      await pruneOldBackups(retention);
    } else {
      void auditLog({
        event: "BACKUP_FAILED",
        operatorId: input.triggeredBy,
        detail: `Backup failed: ${result.error}`,
      });
    }
  }).catch((err) => logger.error({ err }, "backup post-processing failed"));

  return { id: run.id, status: "running", filePath: null, sizeBytes: null };
}

interface DumpResult { ok: true; sizeBytes: number; } interface DumpFail { ok: false; error: string; }

function executeDump(runId: string, file: string): Promise<DumpResult | DumpFail> {
  return new Promise((resolve) => {
    let stderr = "";
    const child = spawn("pg_dump", ["--no-owner", "--no-acl", "-f", file, databaseUrl()], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (err) => {
      logger.error({ err, runId }, "pg_dump spawn failed");
      resolve({ ok: false, error: err.message });
    });
    child.on("close", async (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr.trim() || `pg_dump exited ${code}` });
        return;
      }
      const st = await stat(file).catch(() => null);
      resolve(st ? { ok: true, sizeBytes: st.size } : { ok: false, error: "dump file missing" });
    });
  });
}
