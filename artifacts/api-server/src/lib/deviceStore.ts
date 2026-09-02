// Module 10.2/10.3 — in-memory cache over the devices + security_settings
// tables so the per-request device guard doesn't hit Postgres on every call.
// Single-instance only (matches lockoutStore.ts); a multi-instance deploy would
// swap this for a shared cache. Mutations from the admin routes call
// invalidate() so changes take effect on the next request.

import { db } from "@workspace/db";
import { devicesTable, securitySettingsTable } from "@workspace/db/schema";
import type { Device, SecuritySettings } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const CACHE_TTL_MS = 10_000;
// How long a successfully-loaded allow-list may keep being served after the DB
// starts failing. Long enough that a Postgres restart or a brief network blip
// doesn't halt a running line; short enough that a de-registered device can't
// keep working for a whole shift.
const STALE_GRACE_MS = 5 * 60_000;
// While the DB is down, don't re-query on every single request.
const FAILURE_BACKOFF_MS = 1_000;

let devicesCache: { at: number; rows: Device[] } | null = null;
let settingsCache: { at: number; row: SecuritySettings | null } | null = null;
let devicesFailureUntil = 0;

/**
 * The device allow-list could not be read and no recent copy is available, so
 * we cannot tell whether the caller is a registered device. The guard turns
 * this into a 503 — it must NOT be treated as "no devices registered".
 */
export class DeviceLookupUnavailableError extends Error {
  constructor(cause: unknown) {
    super("device allow-list lookup failed and no recent copy is available");
    this.name = "DeviceLookupUnavailableError";
    this.cause = cause;
  }
}

/**
 * Postgres 42P01 undefined_table — the migration hasn't been applied, so no
 * allow-list can exist yet and bootstrap allow-all is the correct answer. This
 * is the one failure that must stay fail-OPEN, otherwise a fresh install can
 * never register its first device.
 */
function isUndefinedTable(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === "42P01";
}

export function invalidateDeviceCache(): void {
  devicesCache = null;
  devicesFailureUntil = 0;
}
export function invalidateSecuritySettingsCache(): void {
  settingsCache = null;
}

export async function getDevices(): Promise<Device[]> {
  const now = Date.now();
  if (devicesCache && now - devicesCache.at < CACHE_TTL_MS) {
    return devicesCache.rows;
  }
  // The DB failed very recently — serve the last good copy rather than piling
  // more doomed queries onto it. Past STALE_GRACE_MS there is nothing to serve.
  if (now < devicesFailureUntil && devicesCache) {
    if (now - devicesCache.at < STALE_GRACE_MS) return devicesCache.rows;
  }
  try {
    const rows = await db.select().from(devicesTable);
    devicesCache = { at: Date.now(), rows };
    devicesFailureUntil = 0;
    return rows;
  } catch (err) {
    if (isUndefinedTable(err)) {
      logger.warn(
        { err },
        "devices table does not exist (migration not applied) — bootstrap allow-all",
      );
      return [];
    }
    devicesFailureUntil = Date.now() + FAILURE_BACKOFF_MS;
    if (devicesCache && Date.now() - devicesCache.at < STALE_GRACE_MS) {
      logger.warn(
        { err, cacheAgeMs: Date.now() - devicesCache.at },
        "devices lookup failed; serving the last good allow-list",
      );
      return devicesCache.rows;
    }
    // Fail CLOSED: an unreadable allow-list is not an empty allow-list.
    logger.error({ err }, "devices lookup failed with no usable cache; denying access");
    throw new DeviceLookupUnavailableError(err);
  }
}

export async function getActiveDevices(): Promise<Device[]> {
  return (await getDevices()).filter((d) => d.status === "active");
}

const DEFAULT_SETTINGS: SecuritySettings = {
  id: true,
  maintenanceMode: false,
  failedAttemptThreshold: 5,
  sessionTimeoutEndDeviceSec: 1800,
  sessionTimeoutStoreDeviceSec: 1800,
  sessionTimeoutAdminDeviceSec: 900,
  updatedBy: null,
  updatedAt: new Date(),
};

export async function getSecuritySettings(): Promise<SecuritySettings> {
  if (settingsCache && Date.now() - settingsCache.at < CACHE_TTL_MS) {
    return settingsCache.row ?? DEFAULT_SETTINGS;
  }
  try {
    const [row] = await db.select().from(securitySettingsTable).where(eq(securitySettingsTable.id, true));
    settingsCache = { at: Date.now(), row: row ?? null };
    return row ?? DEFAULT_SETTINGS;
  } catch (err) {
    logger.warn({ err }, "security_settings lookup failed; using defaults");
    return DEFAULT_SETTINGS;
  }
}
