import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { dbSizeLog } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { captureSystemSample, pushSample } from "../lib/metricsRingBuffer";
import { runBackupNow, verifyBackupStorage } from "./backup-service";

// Three jobs:
// 1. Metrics tick — every 5 s push a sample into the ring buffer.
// 2. DB size capture — once per day write a row into db_size_log.
// 3. Daily backup — runs at BACKUP_HOUR_LOCAL (default 02:00 local).
//
// All three are self-rescheduling intervals/timeouts. Disable by setting
// ADMIN_BACKGROUND_JOBS=false (used in tests).

const METRICS_INTERVAL_MS = 5_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

let started = false;

export function startAdminBackgroundJobs(): void {
  if (started) return;
  if (process.env.ADMIN_BACKGROUND_JOBS === "false") {
    logger.info("Admin background jobs disabled by ADMIN_BACKGROUND_JOBS=false");
    return;
  }
  started = true;

  const metricsTimer = setInterval(() => {
    pushSample(captureSystemSample({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }));
  }, METRICS_INTERVAL_MS);
  metricsTimer.unref?.();

  const dbSizeTimer = setInterval(captureDbSize, ONE_HOUR_MS); // check hourly; insert at most once per day
  dbSizeTimer.unref?.();
  void captureDbSize();

  // Only schedule backups once storage is verified off-disk (spec §12.1). A
  // misconfigured BACKUP_DIR disables the backup job (loud error) but leaves the
  // metrics/db-size jobs — and the whole API — running.
  void verifyBackupStorage().then((check) => {
    if (check.ok) {
      scheduleNextBackup();
    } else {
      logger.error({ reason: check.reason }, "Scheduled backups NOT started — fix BACKUP_DIR and restart");
    }
  });
  logger.info("Admin background jobs started");
}

async function captureDbSize(): Promise<void> {
  try {
    const result = await db.execute<{ size_bytes: string }>(sql`SELECT pg_database_size(current_database()) AS size_bytes`);
    const rows = (result as unknown as { rows?: Array<{ size_bytes: string | number }> }).rows ?? [];
    const sizeBytes = Number(rows[0]?.size_bytes ?? 0);
    if (!sizeBytes) return;
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    // ON CONFLICT — one row per day; if hourly tick fires more than once we just refresh size.
    await db.execute(sql`
      INSERT INTO db_size_log (date, size_bytes)
      VALUES (${dateStr}::date, ${sizeBytes}::bigint)
      ON CONFLICT (date) DO UPDATE SET size_bytes = EXCLUDED.size_bytes
    `);
  } catch (err) {
    logger.warn({ err }, "captureDbSize failed");
  }
  void dbSizeLog; // keep schema import live
}

function scheduleNextBackup(): void {
  const hour = Number(process.env.BACKUP_HOUR_LOCAL ?? 2);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setTime(next.getTime() + ONE_DAY_MS);
  const delay = next.getTime() - now.getTime();
  const t = setTimeout(async () => {
    try {
      await runBackupNow({});
    } catch (err) {
      logger.error({ err }, "scheduled backup failed");
    }
    scheduleNextBackup();
  }, delay);
  t.unref?.();
  logger.info({ nextBackupAt: next.toISOString() }, "Next backup scheduled");
}
