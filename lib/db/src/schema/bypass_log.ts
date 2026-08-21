import { pgTable, serial, integer, text, date, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Module 8: manual per-stage bypass quantities (AOI / SPI). Charted datewise or
// shiftwise, filterable by date range and line. The stage column is what gives
// the AOI-vs-SPI split (the changeover-level BOM-skip metric cannot).
export const bypassLogTable = pgTable(
  "bypass_log",
  {
    id: serial("id").primaryKey(),
    entryDate: date("entry_date").notNull(),
    shift: text("shift"),
    lineNumber: text("line_number"),
    stage: text("stage").notNull(), // "AOI" | "SPI"
    quantity: integer("quantity").notNull(),
    enteredBy: uuid("entered_by").references(() => usersTable.id),
    enteredByName: text("entered_by_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entryDateIdx: index("bypass_log_entry_date_idx").on(table.entryDate),
    lineNumberIdx: index("bypass_log_line_number_idx").on(table.lineNumber),
    stageIdx: index("bypass_log_stage_idx").on(table.stage),
  })
);

export const insertBypassLogSchema = createInsertSchema(bypassLogTable).omit({
  id: true,
  createdAt: true,
});

export type BypassLog = typeof bypassLogTable.$inferSelect;
export type InsertBypassLog = z.infer<typeof insertBypassLogSchema>;
