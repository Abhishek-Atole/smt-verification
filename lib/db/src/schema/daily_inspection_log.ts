import { pgTable, serial, integer, text, date, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Module 7: manual daily inspection counts (QF-OP-03 sheet). Drives the Summary
// Daily Inspection Status block and PPM = (not_ok_qty / total_qty_checked) * 1e6,
// computed on read — independent of a changeover's total_output_units.
export const dailyInspectionLogTable = pgTable(
  "daily_inspection_log",
  {
    id: serial("id").primaryKey(),
    entryDate: date("entry_date").notNull(),
    partNumber: text("part_number").notNull(),
    lineNumber: text("line_number"),
    shift: text("shift"),
    totalQtyChecked: integer("total_qty_checked").notNull().default(0),
    firstShotQty: integer("first_shot_qty").notNull().default(0),
    okQty: integer("ok_qty").notNull().default(0),
    notOkQty: integer("not_ok_qty").notNull().default(0),
    enteredBy: uuid("entered_by").references(() => usersTable.id),
    enteredByName: text("entered_by_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entryDateIdx: index("daily_inspection_log_entry_date_idx").on(table.entryDate),
    partNumberIdx: index("daily_inspection_log_part_number_idx").on(table.partNumber),
  })
);

export const insertDailyInspectionLogSchema = createInsertSchema(dailyInspectionLogTable).omit({
  id: true,
  createdAt: true,
});

export type DailyInspectionLog = typeof dailyInspectionLogTable.$inferSelect;
export type InsertDailyInspectionLog = z.infer<typeof insertDailyInspectionLogSchema>;
