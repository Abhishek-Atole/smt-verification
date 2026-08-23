import { pgTable, uuid, text, timestamp, boolean, integer, index, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Module 10.1 — device categories. Each device_type maps to a login UI +
// permission set (10.4) and its own IP allow-list (10.2).
export const deviceTypeEnum = pgEnum("device_type", [
  "end_device",   // shop-floor terminals (operator / qa / supervisor login)
  "admin_device", // admin/management terminals
  "store_device", // store/warehouse terminal (storekeeper login)
  "server",       // the host running the DB/backend itself (not a login client)
]);

export const deviceStatusEnum = pgEnum("device_status", ["active", "blocked", "pending"]);

// Module 10.1 — one row per registered device. allowed_ip holds either a single
// IP ("192.168.1.20") or a CIDR range ("192.168.1.0/24"); matched per-request
// by the device guard (10.2). mac_address is an optional extra binding layer.
export const devicesTable = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceType: deviceTypeEnum("device_type").notNull(),
    deviceName: text("device_name").notNull(),
    allowedIp: text("allowed_ip").notNull(), // single IP or CIDR range
    macAddress: text("mac_address"),
    status: deviceStatusEnum("status").notNull().default("pending"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastModifiedBy: text("last_modified_by"),
    lastModifiedAt: timestamp("last_modified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deviceTypeIdx: index("devices_device_type_idx").on(t.deviceType),
    statusIdx: index("devices_status_idx").on(t.status),
  })
);

// Module 10.3 — admin-configurable security settings. Single-row table (id is
// always TRUE) so the config is edited in place, not appended. DB-password
// rotation (10.3) is deliberately NOT modelled here — deferred pending an infra
// decision on where the encryption key lives (it must not live in this DB).
export const securitySettingsTable = pgTable("security_settings", {
  id: boolean("id").primaryKey().default(true), // always true — enforces single row
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  failedAttemptThreshold: integer("failed_attempt_threshold").notNull().default(5),
  // Session timeout (access-token TTL) per device type, in seconds.
  sessionTimeoutEndDeviceSec: integer("session_timeout_end_device_sec").notNull().default(1800),
  sessionTimeoutStoreDeviceSec: integer("session_timeout_store_device_sec").notNull().default(1800),
  sessionTimeoutAdminDeviceSec: integer("session_timeout_admin_device_sec").notNull().default(900),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDeviceSchema = createInsertSchema(devicesTable).omit({
  id: true,
  createdAt: true,
  lastModifiedAt: true,
});

export type Device = typeof devicesTable.$inferSelect;
export type InsertDevice = z.infer<typeof insertDeviceSchema>;
export type DeviceType = (typeof deviceTypeEnum.enumValues)[number];
export type DeviceStatus = (typeof deviceStatusEnum.enumValues)[number];
export type SecuritySettings = typeof securitySettingsTable.$inferSelect;
