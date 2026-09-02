import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { reportArchiveRecordTable } from "@workspace/db/schema";
import { getEffectiveArchiveRoot } from "../lib/reportOutputStore";
import { logger } from "../lib/logger";

// Module 15 — report archival to a fixed filesystem path.
//
// Every session final-report PDF is TEE'd: the same PDFKit output that streams
// to the HTTP response is also piped to an archive file under REPORT_ARCHIVE_ROOT
// (byte-identical to what the operator downloaded — no separate re-render). One
// row per (report_type, related_entity_id) is recorded in report_archive_record
// (path + size + sha256), deduped so re-downloads don't pile up duplicate files.
// Retention is indefinite — nothing prunes this archive.
//
// Storage policy (mirrors Module 12.1, but softer — reports are NOT DR backups):
//   • REPORT_ARCHIVE_ROOT unset/blank → archival DISABLED with a loud error log.
//     Report generation itself is unaffected; the download still works.
//   • Same physical disk as the DB → a warning (never a block). Set
//     REPORT_ARCHIVE_ALLOW_SAME_DISK=true to acknowledge and downgrade to info.

export interface ReportArchiveSink {
  /** Pipe the PDFDocument into this in addition to the HTTP response. */
  stream: NodeJS.WritableStream;
  filePath: string;
  /** Call AFTER doc.end(); waits for flush, hashes, records. Never throws. */
  finalize: () => Promise<void>;
}

function archiveRoot(): string | null {
  const root = process.env.REPORT_ARCHIVE_ROOT?.trim();
  return root ? root : null;
}

// Module 15b — the root actually in force. The admin dashboard setting wins;
// REPORT_ARCHIVE_ROOT stays the fallback so installs configured before that
// table existed keep archiving without an admin visit.
async function effectiveArchiveRoot(): Promise<string | null> {
  try {
    return await getEffectiveArchiveRoot();
  } catch {
    return archiveRoot();
  }
}

// Best-effort same-disk check. Reports are not disaster-recovery snapshots, so
// same-disk is only a warning (unlike backups, which refuse to schedule).
async function warnIfSameDisk(dir: string): Promise<void> {
  try {
    const result = await db.execute<{ data_directory: string }>(sql`SHOW data_directory`);
    const rows = (result as unknown as { rows?: Array<{ data_directory?: string }> }).rows ?? [];
    const dataDir = rows[0]?.data_directory;
    if (!dataDir) return; // remote DB / no privilege → cannot prove same-disk
    const [archiveStat, dataStat] = await Promise.all([
      stat(dir).catch(() => null),
      stat(dataDir).catch(() => null),
    ]);
    const sameDisk = archiveStat != null && dataStat != null && archiveStat.dev === dataStat.dev;
    if (!sameDisk) return;
    if (process.env.REPORT_ARCHIVE_ALLOW_SAME_DISK === "true") {
      logger.info({ dir, dataDir }, "REPORT_ARCHIVE_ROOT is on the same disk as the DB (acknowledged via REPORT_ARCHIVE_ALLOW_SAME_DISK).");
    } else {
      logger.warn(
        { dir, dataDir },
        "REPORT_ARCHIVE_ROOT is on the same physical disk as the Postgres data directory — " +
          "archives will be lost if that disk fails. Point it at a second disk / NAS, or set " +
          "REPORT_ARCHIVE_ALLOW_SAME_DISK=true to acknowledge.",
      );
    }
  } catch {
    // Non-fatal: the check is advisory only.
  }
}

async function alreadyArchived(reportType: string, entityId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: reportArchiveRecordTable.id })
    .from(reportArchiveRecordTable)
    .where(
      and(
        eq(reportArchiveRecordTable.reportType, reportType),
        eq(reportArchiveRecordTable.relatedEntityId, entityId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const rs = createReadStream(filePath);
    rs.on("error", reject);
    rs.on("data", (chunk) => hash.update(chunk));
    rs.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Open an archive sink for a report, or return null when archival is disabled
 * (REPORT_ARCHIVE_ROOT unset) or this entity is already archived (dedup). The
 * caller pipes the PDFDocument into `sink.stream` alongside the HTTP response,
 * then awaits `sink.finalize()` after `doc.end()`. All failures are swallowed
 * and logged — archival must never break report delivery.
 */
export async function beginReportArchive(
  reportType: string,
  entityId: string,
): Promise<ReportArchiveSink | null> {
  try {
    const root = await effectiveArchiveRoot();
    if (!root) {
      logger.error(
        "No report archive root configured — report archival DISABLED (downloads still work). " +
          "Set it on the admin Report Output page, or via REPORT_ARCHIVE_ROOT.",
      );
      return null;
    }

    if (await alreadyArchived(reportType, entityId)) return null;

    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const dir = path.join(root, year, month, reportType);
    await mkdir(dir, { recursive: true });
    await warnIfSameDisk(root);

    const ts = now.toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(dir, `${entityId}_${ts}.pdf`);
    const stream = createWriteStream(filePath);
    // Isolate archive-side stream errors so a full disk can never crash the
    // response pipe; finalize() re-checks the file and skips the DB row.
    let streamError: unknown = null;
    stream.on("error", (err) => {
      streamError = err;
      logger.error({ err, filePath }, "report archive stream error");
    });

    const finished = new Promise<void>((resolve) => {
      stream.on("close", () => resolve());
    });

    const finalize = async () => {
      try {
        await finished;
        if (streamError) {
          await unlink(filePath).catch(() => undefined);
          return;
        }
        const [{ size }, checksum] = await Promise.all([stat(filePath), sha256File(filePath)]);
        const inserted = await db
          .insert(reportArchiveRecordTable)
          .values({ reportType, relatedEntityId: entityId, filePath, fileSizeBytes: size, checksum })
          .onConflictDoNothing()
          .returning({ id: reportArchiveRecordTable.id });
        // Lost the dedup race — another request archived this entity first.
        // Drop our now-redundant file so the archive stays one-per-entity.
        if (inserted.length === 0) {
          await unlink(filePath).catch(() => undefined);
        }
      } catch (err) {
        logger.error({ err, reportType, entityId }, "report archive finalize failed");
        await unlink(filePath).catch(() => undefined);
      }
    };

    return { stream, filePath, finalize };
  } catch (err) {
    logger.error({ err, reportType, entityId }, "report archive setup failed");
    return null;
  }
}
