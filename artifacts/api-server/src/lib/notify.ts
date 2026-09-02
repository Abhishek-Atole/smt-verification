import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { logger } from "./logger";

export type NotificationType = "success" | "info" | "warning" | "error";

// Module 14 — a notification may be scoped to a single role (targetRole), a
// single user (targetUserId), or neither (global). Read visibility is resolved
// in GET /api/notifications, not here. eventClass classifies the row for the UI;
// relatedEntity* / createdByUserId are stable machine keys (createdBy stays
// human-readable for display).
export interface NotificationInput {
  type: NotificationType;
  message: string;
  detail?: string;
  entityId?: string;
  createdBy?: string;
  eventClass?: string;
  targetRole?: string;
  targetUserId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  createdByUserId?: string;
}

// Cross-dashboard notification feed. One row per notable event; dashboards poll
// GET /api/notifications?since=<iso> and toast new rows. Best-effort — a feed
// insert must never break the request path (mirrors auditLog's discipline).
export async function pushNotification(input: NotificationInput): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      type: input.type,
      message: input.message,
      detail: input.detail ?? null,
      entityId: input.entityId ?? null,
      createdBy: input.createdBy ?? null,
      eventClass: input.eventClass ?? null,
      targetRole: input.targetRole ?? null,
      targetUserId: input.targetUserId ?? null,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      createdByUserId: input.createdByUserId ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "notification insert failed");
  }
}
