import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reportsTable = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    reportType: text("report_type")
      .notNull()
      .default("fpy"), // fpy, oee, operator, operator_comparison, feeder, feeder_reliability, alarm, error_analysis, component, lot_traceability
    sessionId: integer("session_id"), // Optional: specific session
    bomId: integer("bom_id"), // Optional: specific BOM
    filters: jsonb("filters").$defaultFn(() => ({})), // { startDate, endDate, line, pcb, operator, shift }
    format: text("format").notNull().default("pdf"), // pdf, xlsx, csv
    filePath: text("file_path"), // Path where report is stored
    recordCount: integer("record_count").default(0), // Number of records in report
    queryTimeMs: integer("query_time").default(0), // Query execution time in milliseconds
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
    generatedBy: text("generated_by").notNull(), // User ID or name
    expiresAt: timestamp("expires_at"), // Report expiration for cleanup
    // Soft delete
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("idx_reports_type_date").on(table.reportType, table.generatedAt),
    index("idx_reports_generated_by").on(table.generatedBy),
    index("idx_reports_session_id").on(table.sessionId),
  ]
);

export const reportExportsTable = pgTable(
  "report_exports",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id")
      .notNull()
      .references(() => reportsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // User who downloaded/exported
    format: text("format").notNull(), // pdf, xlsx, csv
    downloadedAt: timestamp("downloaded_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // PII hashed at rest (bcrypt, 60 chars) — column names/types must match the
    // migrated table, else `select()` emits SQL for non-existent columns → 500.
    ipAddressHash: varchar("ip_address_hash", { length: 64 }), // hashed IP for audit trail
    userAgentHash: varchar("user_agent_hash", { length: 64 }), // hashed client info
    purgeAfter: timestamp("purge_after", { withTimezone: true }), // retention cutoff (DB default now()+90d)
  },
  (table) => [
    index("idx_report_exports_report_id").on(table.reportId),
    index("idx_report_exports_user_id").on(table.userId),
    index("idx_report_exports_downloaded_at").on(table.downloadedAt),
  ]
);

// Valid report types enum
const REPORT_TYPES = [
  "fpy",
  "oee",
  "operator",
  "operator-comparison",
  "feeder",
  "feeder-reliability",
  "alarm",
  "error-analysis",
  "component",
  "lot-traceability",
  "trend",
] as const;

// Zod schemas for validation
const baseInsertReportSchema = createInsertSchema(reportsTable);
export const insertReportSchema = baseInsertReportSchema
  .omit({ id: true }) // Omit auto-generated serial ID
  .extend({
    reportType: z.enum(REPORT_TYPES), // Validate against allowed types
  });

const baseInsertReportExportSchema = createInsertSchema(reportExportsTable);
export const insertReportExportSchema = baseInsertReportExportSchema.omit({ id: true }); // Omit auto-generated serial ID

export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;

export type InsertReportExport = z.infer<typeof insertReportExportSchema>;
export type ReportExport = typeof reportExportsTable.$inferSelect;
