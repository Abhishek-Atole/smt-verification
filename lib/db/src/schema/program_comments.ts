import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { programsTable } from "./programs";
import { usersTable } from "./users";

export const programCommentsTable = pgTable(
  "program_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programsTable.id, { onDelete: "cascade" }),
    comment: text("comment").notNull(),
    department: text("department").notNull().default("General"),
    priority: text("priority").notNull().default("normal"),
    isResolved: boolean("is_resolved").notNull().default(false),
    visibleInExport: boolean("visible_in_export").notNull().default(true),
    authorId: uuid("author_id").references(() => usersTable.id),
    resolvedBy: uuid("resolved_by").references(() => usersTable.id),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    programIdIdx: index("program_comments_program_id_idx").on(table.programId),
    createdAtIdx: index("program_comments_created_at_idx").on(table.createdAt),
    unresolvedIdx: index("program_comments_unresolved_idx").on(table.programId, table.isResolved),
  })
);

export const insertProgramCommentSchema = createInsertSchema(programCommentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
});

export type ProgramComment = typeof programCommentsTable.$inferSelect;
export type InsertProgramComment = z.infer<typeof insertProgramCommentSchema>;
