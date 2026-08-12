import { pgTable, serial, text, integer, timestamp, boolean, index, pgEnum, uuid, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bomsTable } from "./bom";
import { usersTable } from "./users";

export const changeoverSessionStatusEnum = pgEnum("changeover_session_status", [
  "active",
  "completed",
  "cancelled",
  "pending_qa",
  "qa_in_review",
  "qa_confirmed",
  "handed_over",
  "active_splicing",
  "incomplete",
]);
export const qaResultEnum = pgEnum("qa_result", [
  "pass",
  "fail",
  "alternate_accepted",
  "pending",
]);
export const feederScanStatusEnum = pgEnum("feeder_scan_status", ["verified", "failed", "duplicate"]);

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  bomId: integer("bom_id").references(() => bomsTable.id),
  companyName: text("company_name").notNull(),
  customerName: text("customer_name"),
  panelName: text("panel_name").notNull(),
  supervisorName: text("supervisor_name").notNull(),
  operatorName: text("operator_name").notNull(),
  qaName: text("qa_name"), // QA personnel name
  shiftName: text("shift_name").notNull(),
  shiftDate: text("shift_date").notNull(),
  logoUrl: text("logo_url"),
  productionCount: integer("production_count").default(0),
  verificationMode: text("verification_mode").notNull().default("AUTO"),
  status: text("status").notNull().default("active"),
  startTime: timestamp("start_time").defaultNow().notNull(),
  endTime: timestamp("end_time"),
  machineName: text("machine_name"),
  lineName: text("line_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"), // Soft delete timestamp
  deletedBy: text("deleted_by"), // User who deleted
});

export const scanRecordsTable = pgTable(
  "scan_records",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "restrict" }),
    feederNumber: text("feeder_number").notNull(), // Legacy
    feederId: integer("feeder_id"), // New: Reference to feeders table
    spoolBarcode: text("spool_barcode"),
    status: text("status").notNull(),
    partNumber: text("part_number"),
    componentId: integer("component_id"), // New: Reference to components table
    scannedMpn: text("scanned_mpn"), // New: Actual MPN scanned
    lotNumber: text("lot_number"), // New: Component lot
    dateCode: text("date_code"), // New: Manufacturing date code
    reelId: text("reel_id"), // New: Physical reel ID
    alternateUsed: boolean("alternate_used").default(false), // New: Was this an alternate?
    validationResult: text("validation_result"), // 'pass', 'alternate_pass', 'mismatch', 'alternate_not_found'
    internalIdScanned: text("internal_id_scanned"), // NEW: Internal ID scanned (optional)
    verificationMode: text("verification_mode").notNull().default("AUTO"), // 'AUTO' or 'MANUAL'
    matchScore: integer("match_score"), // NEW: 0-100 percentage match score from fuzzy matching
    matchingAlgorithm: text("matching_algorithm"), // NEW: 'exact' | 'fuzzy' | 'normalized'
    expectedValue: text("expected_value"), // NEW: What the system expected to match
    suggestions: text("suggestions"), // NEW: JSON array of alternative matches
    description: text("description"),
    location: text("location"),
    scannedAt: timestamp("scanned_at").defaultNow().notNull(),
  },
  (table) => ({
    sessionIdIdx: index("scan_records_session_id_idx").on(table.sessionId),
    feederIdIdx: index("scan_records_feeder_id_idx").on(table.feederId),
    scannedMpnIdx: index("scan_records_scanned_mpn_idx").on(table.scannedMpn),
    verificationModeIdx: index("scan_records_verification_mode_idx").on(table.verificationMode), // NEW
  })
);

export const spliceRecordsTable = pgTable("splice_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  changeoverId: text("changeover_id").notNull(),
  feederNumber: text("feeder_number"),
  lineItemId: uuid("line_item_id"),
  oldSpoolMpn: text("old_spool_mpn"),
  oldSpoolLot: text("old_spool_lot"),
  newSpoolMpn: text("new_spool_mpn"),
  newSpoolLot: text("new_spool_lot"),
  splicedBy: uuid("spliced_by"),
  splicedAt: timestamp("spliced_at").defaultNow().notNull(),
  oldSpoolLotCode: text("old_spool_lot_code"),
  newSpoolLotCode: text("new_spool_lot_code"),
  oldSpoolMatchedField: text("old_spool_matched_field"),
  newSpoolMatchedField: text("new_spool_matched_field"),
  allocationVerified: boolean("allocation_verified").default(false),
  oldSpoolPayload: jsonb("old_spool_payload"),
  newSpoolPayload: jsonb("new_spool_payload"),
  validationWarnings: jsonb("validation_warnings").default([]),
  durationSeconds: integer("duration_seconds"),
  qaVerifiedById: uuid("qa_verified_by_id").references(() => usersTable.id),
  qaVerifiedAt: timestamp("qa_verified_at"),
  qaResult: qaResultEnum("qa_result"),
});

export const changeoverSessionsTable = pgTable(
  "changeover_sessions",
  {
    id: text("id").primaryKey(), // Format: SMT_YYYYMMDD_NNNNNN
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => usersTable.id),
    bomId: integer("bom_id")
      .notNull()
      .references(() => bomsTable.id, { onDelete: "restrict" }),
    verificationMode: text("verification_mode").notNull().default("AUTO"),
    status: changeoverSessionStatusEnum("status").notNull().default("active"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    qaVerifiedById: uuid("qa_verified_by_id").references(() => usersTable.id),
    qaVerifiedAt: timestamp("qa_verified_at"),
    qaVerificationMethod: text("qa_verification_method"),
    qaDiscrepancyFound: boolean("qa_discrepancy_found").default(false),
    handedOverToOperatorId: uuid("handed_over_to_operator_id").references(() => usersTable.id),
    handedOverToSupervisorId: uuid("handed_over_to_supervisor_id").references(() => usersTable.id),
    handedOverAt: timestamp("handed_over_at"),
    handoverAcceptedAt: timestamp("handover_accepted_at"),
    handoverAcceptedById: uuid("handover_accepted_by_id").references(() => usersTable.id),
    changeoverOperatorId: uuid("changeover_operator_id").references(() => usersTable.id),
    changeoverSupervisorId: uuid("changeover_supervisor_id").references(() => usersTable.id),
    splicingOperatorId: uuid("splicing_operator_id").references(() => usersTable.id),
    qaLockExpiresAt: timestamp("qa_lock_expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    operatorIdIdx: index("changeover_sessions_operator_id_idx").on(table.operatorId),
    bomIdIdx: index("changeover_sessions_bom_id_idx").on(table.bomId),
    verificationModeIdx: index("changeover_sessions_verification_mode_idx").on(table.verificationMode),
    statusIdx: index("changeover_sessions_status_idx").on(table.status),
    qaVerifiedByIdIdx: index("changeover_sessions_qa_verified_by_idx").on(table.qaVerifiedById),
    handedOverToOperatorIdIdx: index("changeover_sessions_handed_over_to_op_idx").on(table.handedOverToOperatorId),
    splicingOperatorIdIdx: index("changeover_sessions_splicing_op_idx").on(table.splicingOperatorId),
  })
);

export const feederScansTable = pgTable(
  "feeder_scans",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => changeoverSessionsTable.id, { onDelete: "restrict" }),
    feederNumber: text("feeder_number").notNull(),
    scannedValue: text("scanned_value").notNull(),
    matchedField: text("matched_field"),
    matchedMake: text("matched_make"),
    lotCode: text("lot_code"),
    verificationMode: text("verification_mode").notNull().default("AUTO"),
    status: feederScanStatusEnum("status").notNull(),
    scannedAt: timestamp("scanned_at").defaultNow().notNull(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => usersTable.id),
    qaVerifiedById: uuid("qa_verified_by_id").references(() => usersTable.id),
    qaVerifiedAt: timestamp("qa_verified_at"),
    qaResult: qaResultEnum("qa_result"),
    qaNotes: text("qa_notes"),
  },
  (table) => ({
    sessionIdIdx: index("feeder_scans_session_id_idx").on(table.sessionId),
    feederNumberIdx: index("feeder_scans_feeder_number_idx").on(table.feederNumber),
    verificationModeIdx: index("feeder_scans_verification_mode_idx").on(table.verificationMode),
    statusIdx: index("feeder_scans_status_idx").on(table.status),
    operatorIdIdx: index("feeder_scans_operator_id_idx").on(table.operatorId),
    qaResultIdx: index("feeder_scans_qa_result_idx").on(table.qaResult),
  })
);

export const sessionHandoversTable = pgTable("session_handovers", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => changeoverSessionsTable.id),
  fromOperatorId: uuid("from_operator_id")
    .notNull()
    .references(() => usersTable.id),
  fromSupervisorId: uuid("from_supervisor_id")
    .references(() => usersTable.id),
  toOperatorId: uuid("to_operator_id")
    .notNull()
    .references(() => usersTable.id),
  toSupervisorId: uuid("to_supervisor_id")
    .references(() => usersTable.id),
  initiatedAt: timestamp("initiated_at").defaultNow().notNull(),
  acceptedAt: timestamp("accepted_at"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true }).extend({
  createdAt: z.date().optional(),
  startTime: z.date().optional(),
});
export const insertScanRecordSchema = createInsertSchema(scanRecordsTable).omit({ id: true }).extend({
  scannedAt: z.date().optional(),
});
export const insertSpliceRecordSchema = createInsertSchema(spliceRecordsTable).omit({ id: true }).extend({
  splicedAt: z.date().optional(),
});
export const insertChangeoverSessionSchema = createInsertSchema(changeoverSessionsTable).omit({ id: true }).extend({
  startedAt: z.date().optional(),
  createdAt: z.date().optional(),
});
export const insertFeederScanSchema = createInsertSchema(feederScansTable).omit({ id: true }).extend({
  scannedAt: z.date().optional(),
});

export type Session = typeof sessionsTable.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type ScanRecord = typeof scanRecordsTable.$inferSelect;
export type InsertScanRecord = z.infer<typeof insertScanRecordSchema>;
export type SpliceRecord = typeof spliceRecordsTable.$inferSelect;
export type InsertSpliceRecord = z.infer<typeof insertSpliceRecordSchema>;
export type ChangeoverSession = typeof changeoverSessionsTable.$inferSelect;
export type InsertChangeoverSession = z.infer<typeof insertChangeoverSessionSchema>;
export type FeederScan = typeof feederScansTable.$inferSelect;
export type InsertFeederScan = z.infer<typeof insertFeederScanSchema>;
export const insertSessionHandoverSchema = createInsertSchema(sessionHandoversTable).omit({ id: true }).extend({
  initiatedAt: z.date().optional(),
});
export type SessionHandover = typeof sessionHandoversTable.$inferSelect;
export type InsertSessionHandover = z.infer<typeof insertSessionHandoverSchema>;
