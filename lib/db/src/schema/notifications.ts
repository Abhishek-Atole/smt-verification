import { pgTable, serial, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Cross-dashboard notification feed. Written by the api-server on notable
// events (BOM changes, handover, QA requests/results, admin broadcasts); every
// dashboard polls GET /api/notifications?since=<iso> and toasts new rows.
// Deliberately kept separate from the immutable audit_logs chain — this is a
// product feed, not a security artifact.
//
// Module 14 — targeting + seen. A row can be scoped to a single role
// (target_role), a single user (target_user_id), or neither (global). Read
// visibility is computed at query time in GET /notifications (supervisor/admin
// see everything; others see global + their-role + their-user rows). Per-user
// "seen" lives in the separate notification_seen table, not here — a role-
// targeted row is seen independently by each user in that role.
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(), // toast severity: success | info | warning | error
    message: text("message").notNull(), // short headline
    detail: text("detail"), // optional secondary line
    entityId: text("entity_id"), // legacy generic entity ref (kept for back-compat)
    createdBy: text("created_by"), // actor username/name who triggered it (display)
    // Module 14 additions — all nullable so pre-existing rows and un-targeted
    // inserts stay valid.
    eventClass: text("event_class"), // bom | handover | qa_request | qa_result | broadcast
    targetRole: text("target_role"), // null = not role-scoped
    targetUserId: text("target_user_id"), // null = not user-scoped
    relatedEntityType: text("related_entity_type"), // e.g. "bom" | "session"
    relatedEntityId: text("related_entity_id"),
    createdByUserId: text("created_by_user_id"), // stable actor id (createdBy is display-only)
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
    targetRoleIdx: index("notifications_target_role_idx").on(table.targetRole),
    targetUserIdx: index("notifications_target_user_idx").on(table.targetUserId),
  })
);

// Module 14 — per-user read state for the notification bell. One row per
// (notification, user) that has viewed it; absence = unread for that user.
// History in `notifications` is retained indefinitely; this table only records
// who has seen what. FK cascades so a purged notification takes its seen rows.
export const notificationSeenTable = pgTable(
  "notification_seen",
  {
    id: serial("id").primaryKey(),
    notificationId: integer("notification_id")
      .notNull()
      .references(() => notificationsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    seenAt: timestamp("seen_at").defaultNow().notNull(),
  },
  (table) => ({
    userNotifIdx: uniqueIndex("notification_seen_user_notif_idx").on(table.notificationId, table.userId),
    userIdx: index("notification_seen_user_idx").on(table.userId),
  })
);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
}).extend({
  createdAt: z.date().optional(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

export type NotificationSeen = typeof notificationSeenTable.$inferSelect;
