import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Editable approver rosters for the New Changeover form. Supervisor/QA names
// were hardcoded in the frontend; they now live here so qa/supervisor/admin
// users can add/remove them at runtime via the Manage Approvers screen.
export const approversTable = pgTable(
  "approvers",
  {
    id: serial("id").primaryKey(),
    category: text("category").notNull(), // "supervisor" | "qa"
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    categoryNameUq: uniqueIndex("approvers_category_name_uq").on(table.category, table.name),
  })
);

export const insertApproverSchema = createInsertSchema(approversTable).omit({
  id: true,
  createdAt: true,
});

export type Approver = typeof approversTable.$inferSelect;
export type InsertApprover = z.infer<typeof insertApproverSchema>;
