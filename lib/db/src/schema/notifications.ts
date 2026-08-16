import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Cross-dashboard notification feed. Written by the api-server on notable
// events (currently BOM create/update/delete/restore); every dashboard polls
// GET /api/notifications?since=<iso> and toasts new rows. Deliberately kept
// separate from the immutable audit_logs chain — this is a product feed, not a
// security artifact.
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(), // toast severity: success | info | warning | error
    message: text("message").notNull(), // short headline
    detail: text("detail"), // optional secondary line
    entityId: text("entity_id"), // e.g. the BOM id the event refers to
    createdBy: text("created_by"), // actor username/id who triggered it
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
  })
);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
}).extend({
  createdAt: z.date().optional(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
