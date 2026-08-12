import { pgTable, uuid, text, bigint, date, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// login_events — one row per login attempt (success or failure). Read by admin login-activity viewer.
export const loginEventsTable = pgTable(
  "login_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    employeeId: text("employee_id"),      // snapshot at login time (user may be deleted later)
    ip: text("ip"),
    userAgent: text("user_agent"),
    result: text("result").notNull(),     // 'success' | 'failure'
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("login_events_created_at_idx").on(t.createdAt),
    userIdIdx:    index("login_events_user_id_idx").on(t.userId),
  })
);

// db_size_log — one row per day, written by daily cron (U18)
export const dbSizeLog = pgTable("db_size_log", {
  date:      date("date").primaryKey(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// backup_schedules — schedule config (one row seeded at install time)
export const backupSchedulesTable = pgTable("backup_schedules", {
  id:            uuid("id").primaryKey().defaultRandom(),
  cronExpr:      text("cron_expr").notNull().default("0 2 * * *"),
  retentionDays: integer("retention_days").notNull().default(30),
  isEnabled:     boolean("is_enabled").notNull().default(true),
  createdBy:     uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// backup_runs — one row per backup attempt
export const backupRunsTable = pgTable(
  "backup_runs",
  {
    id:           uuid("id").primaryKey().defaultRandom(),
    scheduleId:   uuid("schedule_id").references(() => backupSchedulesTable.id, { onDelete: "set null" }),
    triggeredBy:  uuid("triggered_by").references(() => usersTable.id, { onDelete: "set null" }),
    startedAt:    timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt:   timestamp("finished_at", { withTimezone: true }),
    status:       text("status").notNull().default("running"), // 'running' | 'success' | 'failed'
    filePath:     text("file_path"),
    sizeBytes:    bigint("size_bytes", { mode: "number" }),
    errorMessage: text("error_message"),
  },
  (t) => ({
    startedAtIdx: index("backup_runs_started_at_idx").on(t.startedAt),
    statusIdx:    index("backup_runs_status_idx").on(t.status),
  })
);

export type LoginEvent   = typeof loginEventsTable.$inferSelect;
export type DbSizeLog    = typeof dbSizeLog.$inferSelect;
export type BackupRun    = typeof backupRunsTable.$inferSelect;
