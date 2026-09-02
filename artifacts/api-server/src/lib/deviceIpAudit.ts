// Module 10.2 — startup audit of stored device allow-list entries.
//
// Before 2026-08-30 `isValidIpOrCidr` accepted malformed entries: a trailing
// slash ("192.168.1.0/") was read by matchesIp as /0, i.e. allow every address
// of that family. The validator is now strict, but rows written before the fix
// are still in the table. This pass reports them at boot so an admin can review
// and correct each one by hand.
//
// It deliberately does NOT modify or delete anything. A stored entry is the
// admin's stated intent; silently rewriting "192.168.1.0/" to either
// "192.168.1.0/24" (guessing) or nothing (locking a line out) would substitute
// our guess for theirs without telling anyone. Reporting is the whole job.

import { db } from "@workspace/db";
import { devicesTable } from "@workspace/db/schema";
import { isValidIpOrCidr } from "./ipMatch";
import { logger } from "./logger";

export interface MalformedDeviceEntry {
  id: string;
  deviceName: string;
  allowedIp: string;
  status: string;
  /** True if this entry was being read as allow-all before the strict validator. */
  wasAllowAll: boolean;
}

/**
 * Which stored entries fail the strict validator. Exported separately from the
 * logging wrapper so the admin API (Issue 2) and tests can reuse the same
 * classification the boot log reports.
 */
export function findMalformedEntries(
  rows: Array<{ id: string; deviceName: string; allowedIp: string; status: string }>,
): MalformedDeviceEntry[] {
  return rows
    .filter((row) => !isValidIpOrCidr(row.allowedIp))
    .map((row) => ({
      id: row.id,
      deviceName: row.deviceName,
      allowedIp: row.allowedIp,
      status: row.status,
      // A bare trailing slash was the dangerous form: Number("") === 0 made it
      // a /0. Detect it by asking whether it used to match an unrelated address.
      wasAllowAll: /\/\s*$/.test(row.allowedIp),
    }));
}

/**
 * Log any stored allow-list entry that the strict validator rejects. Called once
 * at boot. Never throws — a failed audit must not stop the server, since the
 * device guard itself already fails closed on an unreadable allow-list.
 */
export async function auditStoredDeviceIps(): Promise<MalformedDeviceEntry[]> {
  try {
    const rows = await db.select().from(devicesTable);
    const malformed = findMalformedEntries(rows);
    if (malformed.length === 0) {
      logger.info(
        { deviceCount: rows.length },
        "Device allow-list audit: all stored allowed_ip values pass strict validation",
      );
      return [];
    }

    for (const entry of malformed) {
      logger.error(
        {
          deviceId: entry.id,
          deviceName: entry.deviceName,
          allowedIp: entry.allowedIp,
          status: entry.status,
          wasAllowAll: entry.wasAllowAll,
        },
        entry.wasAllowAll
          ? "Device allow-list audit: MALFORMED allowed_ip that was previously matching EVERY address (trailing slash read as /0). This device now matches nothing — edit it in the admin Control Panel to the intended range."
          : "Device allow-list audit: MALFORMED allowed_ip rejected by strict validation. This device matches nothing — edit it in the admin Control Panel.",
      );
    }
    logger.error(
      { malformedCount: malformed.length, deviceCount: rows.length },
      "Device allow-list audit: stored entries need manual correction (nothing was modified automatically)",
    );
    return malformed;
  } catch (err) {
    // Includes the un-migrated case (42P01) — nothing to audit yet.
    logger.warn({ err }, "Device allow-list audit skipped: devices lookup failed");
    return [];
  }
}
