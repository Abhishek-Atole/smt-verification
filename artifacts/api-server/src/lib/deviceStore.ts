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

let devicesCache: { at: number; rows: Device[] } | null = null;
let settingsCache: { at: number; row: SecuritySettings | null } | null = null;

export function invalidateDeviceCache(): void {
  devicesCache = null;
}
export function invalidateSecuritySettingsCache(): void {
  settingsCache = null;
}

export async function getDevices(): Promise<Device[]> {
  if (devicesCache && Date.now() - devicesCache.at < CACHE_TTL_MS) {
    return devicesCache.rows;
  }
  try {
    const rows = await db.select().from(devicesTable);
    devicesCache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    // Table missing (migration not yet applied) or DB error — fail OPEN for the
    // device list so a un-migrated install isn't bricked. The guard treats an
    // empty list as bootstrap allow-all.
    logger.warn({ err }, "devices lookup failed; treating as no devices");
    return [];
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
