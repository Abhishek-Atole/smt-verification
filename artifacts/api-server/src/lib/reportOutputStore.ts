// Module 15b — cached read of the single-row report_output_settings table.
// Mirrors the getSecuritySettings() shape in deviceStore.ts: short TTL, admin
// mutations call invalidate(), and a failed read degrades to defaults rather
// than throwing (report delivery must never depend on this lookup).

import { db } from "@workspace/db";
import { reportOutputSettingsTable } from "@workspace/db/schema";
import type { ReportOutputSettings } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const CACHE_TTL_MS = 10_000;

// Archival off, client folder off. On a fresh install (or if the migration
// hasn't run) nothing is written anywhere and downloads behave as before.
const DEFAULT_SETTINGS: ReportOutputSettings = {
  id: true,
  clientFolderEnabled: false,
  folderLabel: null,
  organizeSubfolders: true,
  archiveEnabled: false,
  archiveRoot: null,
  updatedBy: null,
  updatedAt: new Date(0),
};

let cache: { at: number; row: ReportOutputSettings | null } | null = null;

export function invalidateReportOutputSettingsCache(): void {
  cache = null;
}

export async function getReportOutputSettings(): Promise<ReportOutputSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.row ?? DEFAULT_SETTINGS;
  }
  try {
    const [row] = await db
      .select()
      .from(reportOutputSettingsTable)
      .where(eq(reportOutputSettingsTable.id, true));
    cache = { at: Date.now(), row: row ?? null };
    return row ?? DEFAULT_SETTINGS;
  } catch (err) {
    logger.warn({ err }, "report_output_settings lookup failed; using defaults");
    return DEFAULT_SETTINGS;
  }
}

/**
 * The archive root actually in force: the DB setting wins, REPORT_ARCHIVE_ROOT
 * is the fallback for installs that configured it before this table existed.
 * null → archival disabled.
 */
export async function getEffectiveArchiveRoot(): Promise<string | null> {
  const settings = await getReportOutputSettings();
  if (settings.archiveEnabled) {
    const root = settings.archiveRoot?.trim();
    if (root) return root;
  }
  // archiveEnabled=false is an explicit off switch only once a root was ever
  // configured; before that, defer to the env var so existing deploys keep
  // archiving without an admin visit.
  if (settings.archiveRoot?.trim()) return null;
  return process.env.REPORT_ARCHIVE_ROOT?.trim() || null;
}
