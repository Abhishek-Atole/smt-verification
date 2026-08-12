import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { programIssuesTable } from "./program_issues";
import { usersTable } from "./users";

export const issueCommentsTable = pgTable(
  "issue_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => programIssuesTable.id, { onDelete: "cascade" }),
    comment: text("comment").notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    issueIdIdx: index("issue_comments_issue_id_idx").on(table.issueId),
    createdAtIdx: index("issue_comments_created_at_idx").on(table.createdAt),
  })
);

export const insertIssueCommentSchema = createInsertSchema(issueCommentsTable).omit({
  id: true,
  createdAt: true,
});

export type IssueComment = typeof issueCommentsTable.$inferSelect;
export type InsertIssueComment = z.infer<typeof insertIssueCommentSchema>;
