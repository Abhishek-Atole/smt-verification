import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { notificationsTable, notificationSeenTable } from "@workspace/db/schema";
import { and, desc, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";
import { attachActor, requireAuth, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

// Module 14 — a row is visible to an actor when it is un-targeted (global), or
// targets the actor's role, or targets the actor's own id. Supervisors and
// admins additionally see everything (oversight). Returns undefined for the
// oversight roles so no WHERE fragment is added.
function visibilityFilter(role: string, userId: string): SQL | undefined {
  if (role === "supervisor" || role === "admin") return undefined;
  return or(
    and(isNull(notificationsTable.targetRole), isNull(notificationsTable.targetUserId)),
    eq(notificationsTable.targetRole, role),
    eq(notificationsTable.targetUserId, userId),
  );
}

// Cross-dashboard notification feed. Dashboards poll this with the timestamp of
// the newest row they have already shown (?since=<iso>) and toast anything newer.
// Rows are scoped to the caller (Module 14) and carry a per-user `seen` flag
// resolved from notification_seen.
router.get("/notifications", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  const actor = req.actor!;
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const sinceRaw = typeof req.query.since === "string" ? req.query.since : "";
  const since = sinceRaw ? new Date(sinceRaw) : null;
  const validSince = since && !Number.isNaN(since.getTime()) ? since : null;

  const conds = [
    visibilityFilter(actor.role, actor.userId),
    validSince ? gt(notificationsTable.createdAt, validSince) : undefined,
  ].filter((c): c is SQL => Boolean(c));
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: notificationsTable.id,
      type: notificationsTable.type,
      message: notificationsTable.message,
      detail: notificationsTable.detail,
      eventClass: notificationsTable.eventClass,
      relatedEntityType: notificationsTable.relatedEntityType,
      relatedEntityId: notificationsTable.relatedEntityId,
      createdAt: notificationsTable.createdAt,
      seenAt: notificationSeenTable.seenAt,
    })
    .from(notificationsTable)
    .leftJoin(
      notificationSeenTable,
      and(
        eq(notificationSeenTable.notificationId, notificationsTable.id),
        eq(notificationSeenTable.userId, actor.userId),
      ),
    )
    .where(where)
    .orderBy(desc(notificationsTable.id))
    .limit(limit);

  res.json({
    notifications: rows.map(({ seenAt, ...row }) => ({ ...row, seen: seenAt !== null })),
  });
});

// Module 14 — mark notifications seen for the calling user. Body { ids: number[] }
// records one notification_seen row per (notification, user); already-seen rows
// are left untouched (onConflictDoNothing). The notification history itself is
// never mutated or deleted here. The client calls this when the bell is opened
// ("auto-clear on view"), passing the ids currently displayed.
router.post("/notifications/seen", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  const actor = req.actor!;
  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = Array.from(
    new Set(
      rawIds
        .map((v: unknown) => Number(v))
        .filter((n: number) => Number.isInteger(n) && n > 0),
    ),
  ) as number[];

  if (ids.length === 0) {
    res.json({ marked: 0 });
    return;
  }

  // Only stamp rows the caller can actually see, so a client can't mark another
  // user's targeted notification on their behalf.
  const visibility = visibilityFilter(actor.role, actor.userId);
  const visibleWhere = visibility
    ? and(inArray(notificationsTable.id, ids), visibility)
    : inArray(notificationsTable.id, ids);
  const visible = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(visibleWhere);

  if (visible.length === 0) {
    res.json({ marked: 0 });
    return;
  }

  await db
    .insert(notificationSeenTable)
    .values(visible.map((r) => ({ notificationId: r.id, userId: actor.userId })))
    .onConflictDoNothing();

  res.json({ marked: visible.length });
});

export default router;
