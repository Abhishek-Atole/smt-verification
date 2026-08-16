import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { desc, gt } from "drizzle-orm";
import { attachActor, requireAuth, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

// Cross-dashboard notification feed. Dashboards poll this with the timestamp of
// the newest row they have already shown (?since=<iso>) and toast anything newer.
router.get("/notifications", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const sinceRaw = typeof req.query.since === "string" ? req.query.since : "";
  const since = sinceRaw ? new Date(sinceRaw) : null;
  const validSince = since && !Number.isNaN(since.getTime()) ? since : null;

  const rows = validSince
    ? await db.select().from(notificationsTable)
        .where(gt(notificationsTable.createdAt, validSince))
        .orderBy(desc(notificationsTable.id)).limit(limit)
    : await db.select().from(notificationsTable)
        .orderBy(desc(notificationsTable.id)).limit(limit);

  res.json({ notifications: rows });
});

export default router;
