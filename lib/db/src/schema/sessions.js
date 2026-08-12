import { pgTable, serial, text, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bomsTable } from "./bom";
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
    status: text("status").notNull().default("active"),
    startTime: timestamp("start_time").defaultNow().notNull(),
    endTime: timestamp("end_time"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"), // Soft delete timestamp
    deletedBy: text("deleted_by"), // User who deleted
});
export const scanRecordsTable = pgTable("scan_records", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
        .notNull()
        .references(() => sessionsTable.id, { onDelete: "cascade" }),
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
    verificationMode: text("verification_mode").default("manual"), // NEW: 'manual' or 'auto'
    matchScore: integer("match_score"), // NEW: 0-100 percentage match score from fuzzy matching
    matchingAlgorithm: text("matching_algorithm"), // NEW: 'exact' | 'fuzzy' | 'normalized'
    expectedValue: text("expected_value"), // NEW: What the system expected to match
    suggestions: text("suggestions"), // NEW: JSON array of alternative matches
    description: text("description"),
    location: text("location"),
    scannedAt: timestamp("scanned_at").defaultNow().notNull(),
}, (table) => ({
    sessionIdIdx: index("scan_records_session_id_idx").on(table.sessionId),
    feederIdIdx: index("scan_records_feeder_id_idx").on(table.feederId),
    scannedMpnIdx: index("scan_records_scanned_mpn_idx").on(table.scannedMpn),
    verificationModeIdx: index("scan_records_verification_mode_idx").on(table.verificationMode), // NEW
}));
export const spliceRecordsTable = pgTable("splice_records", {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
        .notNull()
        .references(() => sessionsTable.id, { onDelete: "cascade" }),
    feederNumber: text("feeder_number").notNull(),
    oldSpoolBarcode: text("old_spool_barcode").notNull(),
    newSpoolBarcode: text("new_spool_barcode").notNull(),
    durationSeconds: integer("duration_seconds"),
    splicedAt: timestamp("spliced_at").defaultNow().notNull(),
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
