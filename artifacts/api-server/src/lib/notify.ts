import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { logger } from "./logger";

export type NotificationType = "success" | "info" | "warning" | "error";

export interface NotificationInput {
  type: NotificationType;
  message: string;
  detail?: string;
  entityId?: string;
  createdBy?: string;
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
    });
  } catch (err) {
    logger.warn({ err }, "notification insert failed");
  }
}
