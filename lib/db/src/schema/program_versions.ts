import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { programsTable } from "./programs";
import { usersTable } from "./users";

export const programVersionsTable = pgTable(
  "program_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programsTable.id, { onDelete: "cascade" }),
    versionLabel: text("version_label").notNull(),
    notes: text("notes"),
    sourceVersionId: uuid("source_version_id"),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id),
  },
  (table) => ({
    programIdIdx: index("program_versions_program_id_idx").on(table.programId),
    versionLabelIdx: index("program_versions_version_label_idx").on(table.versionLabel),
  })
);

export const insertProgramVersionSchema = createInsertSchema(programVersionsTable).omit({
  id: true,
  createdAt: true,
});

export type ProgramVersion = typeof programVersionsTable.$inferSelect;
export type InsertProgramVersion = z.infer<typeof insertProgramVersionSchema>;
