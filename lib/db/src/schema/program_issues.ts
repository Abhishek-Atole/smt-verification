import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { programsTable } from "./programs";
import { programVersionsTable } from "./program_versions";
import { usersTable } from "./users";

export const programIssuesTable = pgTable(
  "program_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programsTable.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => programVersionsTable.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    severity: text("severity").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    assignedTo: uuid("assigned_to").references(() => usersTable.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => usersTable.id),
    resolvedBy: uuid("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
    closedBy: uuid("closed_by").references(() => usersTable.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at"),
    closedAt: timestamp("closed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    programIdIdx: index("program_issues_program_id_idx").on(table.programId),
    statusIdx: index("program_issues_status_idx").on(table.status),
    severityIdx: index("program_issues_severity_idx").on(table.severity),
  })
);

export const insertProgramIssueSchema = createInsertSchema(programIssuesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProgramIssue = typeof programIssuesTable.$inferSelect;
export type InsertProgramIssue = z.infer<typeof insertProgramIssueSchema>;
