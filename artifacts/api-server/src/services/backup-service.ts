import { spawn } from "node:child_process";
import { mkdir, stat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { backupRunsTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";

// Backup service uses pg_dump to write a plain-SQL file into BACKUP_DIR.
// On success, the row's status flips to 'success' and file_path/size_bytes are filled.
// On failure, status='failed' with error_message captured.
//
// Restore is intentionally NOT exposed via API (per PRD §8 — manual psql only).

function backupDir(): string {
  return process.env.BACKUP_DIR ?? path.resolve(process.cwd(), "backups");
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  return url;
}

async function pruneOldBackups(retentionDays: number): Promise<void> {
  if (retentionDays <= 0) return;
  const dir = backupDir();
  try {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.startsWith("backup-") || !f.endsWith(".sql")) continue;
      const full = path.join(dir, f);
      const st = await stat(full).catch(() => null);
      if (st && st.mtimeMs < cutoff) {
        await unlink(full).catch(() => undefined);
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
      const retention = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
      await pruneOldBackups(retention);
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
