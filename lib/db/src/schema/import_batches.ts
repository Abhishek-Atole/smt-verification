import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const importBatchesTable = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    fileType: text("file_type").notNull(),
    totalRows: integer("total_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),
    skippedRows: integer("skipped_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    status: text("status").notNull().default("processing"),
    errors: jsonb("errors"),
    importedBy: uuid("imported_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    createdAtIdx: index("import_batches_created_at_idx").on(table.createdAt),
    statusIdx: index("import_batches_status_idx").on(table.status),
  })
);

export const insertImportBatchSchema = createInsertSchema(importBatchesTable).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export type ImportBatch = typeof importBatchesTable.$inferSelect;
export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
