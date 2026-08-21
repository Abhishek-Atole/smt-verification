import { pgTable, serial, integer, text, date, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

// Module 7: QA in-house rejections logged against a changeover. PPM is derived
// downstream as (SUM(quantity) / session.total_output_units) * 1e6, so this
// table only stores the raw rejected-unit counts per defect type.
export const qaInhouseRejectionsTable = pgTable(
  "qa_inhouse_rejections",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    defectType: text("defect_type").notNull(),
    quantity: integer("quantity").notNull(),
    remarks: text("remarks"),
    recordedBy: uuid("recorded_by").references(() => usersTable.id),
    recordedByName: text("recorded_by_name"),
    // Module 7.5 Defect Details — nullable so the original session-keyed logger
    // keeps working; populated by the changeover-autopopulate form.
    entryDate: date("entry_date"),
    lineNumber: text("line_number"),
    bomName: text("bom_name"),
    partNumber: text("part_number"),
    stage: text("stage"), // AOI | SPI | Final
    component: text("component"),
    location: text("location"),
    machine: text("machine"),
    shift: text("shift"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    sessionIdIdx: index("qa_inhouse_rejections_session_id_idx").on(table.sessionId),
    defectTypeIdx: index("qa_inhouse_rejections_defect_type_idx").on(table.defectType),
    entryDateIdx: index("qa_inhouse_rejections_entry_date_idx").on(table.entryDate),
  })
);

export const insertQaInhouseRejectionSchema = createInsertSchema(qaInhouseRejectionsTable).omit({
  id: true,
  createdAt: true,
});

export type QaInhouseRejection = typeof qaInhouseRejectionsTable.$inferSelect;
export type InsertQaInhouseRejection = z.infer<typeof insertQaInhouseRejectionSchema>;
