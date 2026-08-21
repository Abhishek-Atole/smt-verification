import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Module 7: editable QA master lists (defect types, machines) used by the
// Defect Details form and the Pareto defect axis. Mirrors the approvers triad:
// category-discriminated value rows, editable at runtime by qa/supervisor/admin.
export const masterListsTable = pgTable(
  "master_lists",
  {
    id: serial("id").primaryKey(),
    category: text("category").notNull(), // "defect_type" | "machine"
    value: text("value").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    categoryValueUq: uniqueIndex("master_lists_category_value_uq").on(table.category, table.value),
  })
);

export const insertMasterListSchema = createInsertSchema(masterListsTable).omit({
  id: true,
  createdAt: true,
});

export type MasterList = typeof masterListsTable.$inferSelect;
export type InsertMasterList = z.infer<typeof insertMasterListSchema>;
