import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { componentsTable } from "./components";

export const componentAlternatesTable = pgTable(
  "component_alternates",
  {
    id: serial("id").primaryKey(),
    primaryComponentId: integer("primary_component_id")
      .notNull()
      .references(() => componentsTable.id, { onDelete: "cascade" }),
    alternateComponentId: integer("alternate_component_id")
      .notNull()
      .references(() => componentsTable.id, { onDelete: "cascade" }),
    approvalStatus: text("approval_status").notNull().default("approved"), // 'approved', 'pending', 'rejected'
    approvedBy: text("approved_by"),
    approvalDate: timestamp("approval_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueAlternate: unique("unique_component_alternate").on(
      table.primaryComponentId,
      table.alternateComponentId
    ),
  })
);

export const insertComponentAlternateSchema = createInsertSchema(componentAlternatesTable).omit({
  id: true,
  createdAt: true,
});

export type ComponentAlternate = typeof componentAlternatesTable.$inferSelect;
export type InsertComponentAlternate = z.infer<typeof insertComponentAlternateSchema>;
