import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { bomsTable, bomItemsTable, sessionsTable, scanRecordsTable } from "@workspace/db/schema";
import { eq, isNotNull, isNull, and, or, desc, asc, like, sql, gt, lt } from "drizzle-orm";
import { attachActor, requireAuth, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

router.use(attachActor);
router.get("/trash/items", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { type = "all", sortBy = "deletedAt", order = "desc", search = "" } = req.query;
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = parseInt(req.query.limit as string) || 20;

    let deletedBoms: any[] = [];
    let deletedItems: any[] = [];
    let deletedSessions: any[] = [];
    let totalCount = 0;

    // Get deleted BOMs
    if (type === "all" || type === "bom") {
      const bomResults = await db
        .select()
        .from(bomsTable)
        .where(
          and(
            isNotNull(bomsTable.deletedAt),
            search ? like(bomsTable.name, `%${search}%`) : undefined
          )
        )
        .orderBy(
          order === "asc"
            ? asc(bomsTable.deletedAt)
            : desc(bomsTable.deletedAt)
        )
        .limit(limit)
        .offset(offset);

      deletedBoms = bomResults.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        type: "bom",
        deletedAt: b.deletedAt,
        deletedBy: b.deletedBy,
        createdAt: b.createdAt,
      }));

      const bomCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(bomsTable)
        .where(isNotNull(bomsTable.deletedAt))
        .then((r) => r[0]?.count || 0);

      totalCount += bomCount;
    }

    // Get deleted BOM items
    if (type === "all" || type === "bom_item") {
      const itemResults = await db
        .select()
        .from(bomItemsTable)
        .where(
          and(
            isNotNull(bomItemsTable.deletedAt),
            search ? like(bomItemsTable.partNumber, `%${search}%`) : undefined
          )
        )
        .orderBy(
          order === "asc"
            ? asc(bomItemsTable.deletedAt)
            : desc(bomItemsTable.deletedAt)
        );

      deletedItems = itemResults.map((item) => ({
        id: item.id,
        name: `${item.partNumber} - ${item.description || ""}`,
        partNumber: item.partNumber,
        bomId: item.bomId,
        type: "bom_item",
        deletedAt: item.deletedAt,
        deletedBy: item.deletedBy,
      }));

      if (type === "bom_item") {
        totalCount = deletedItems.length;
      }
    }

    // Get deleted sessions
    if (type === "all" || type === "session") {
      const sessionResults = await db
        .select()
        .from(sessionsTable)
        .where(
          and(
            isNotNull(sessionsTable.deletedAt),
            search
              ? or(
                  like(sessionsTable.panelName, `%${search}%`),
                  like(sessionsTable.companyName, `%${search}%`)
                )
              : undefined
          )
        )
        .orderBy(
          order === "asc"
            ? asc(sessionsTable.deletedAt)
            : desc(sessionsTable.deletedAt)
        );

      deletedSessions = sessionResults.map((s) => ({
        id: s.id,
        name: `${s.panelName} - ${s.companyName}`,
        panelName: s.panelName,
        companyName: s.companyName,
        type: "session",
        deletedAt: s.deletedAt,
        deletedBy: s.deletedBy,
        createdAt: s.createdAt,
      }));

      if (type === "session") {
        totalCount = deletedSessions.length;
      }
    }

    const items = [...deletedBoms, ...deletedItems, ...deletedSessions];

    if (type === "all") {
      totalCount = items.length;
    }

    return res.json({
      items: items.slice(offset, offset + limit),
      totalCount,
      offset,
      limit,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to fetch trash items" });
  }
});

// Get trash statistics
router.get("/trash/stats", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const bomCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bomsTable)
      .where(isNotNull(bomsTable.deletedAt))
      .then((r) => r[0]?.count || 0);

    const itemCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bomItemsTable)
      .where(isNotNull(bomItemsTable.deletedAt))
      .then((r) => r[0]?.count || 0);

    const sessionCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessionsTable)
      .where(isNotNull(sessionsTable.deletedAt))
      .then((r) => r[0]?.count || 0);

    const totalCount = bomCount + itemCount + sessionCount;

    return res.json({
      bomCount,
      itemCount,
      sessionCount,
      totalCount,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to fetch trash stats" });
  }
});

// Recover a deleted item
router.post("/trash/:type/:id/recover", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const typeParam = req.params.type as string;
    const idParam = req.params.id as string;
    const userId = req.actor?.username || "unknown";

    switch (typeParam) {
      case "bom":
        await db
          .update(bomsTable)
          .set({ deletedAt: null, deletedBy: null })
          .where(eq(bomsTable.id, parseInt(idParam)));
        break;
      case "bom_item":
        await db
          .update(bomItemsTable)
          .set({ deletedAt: null, deletedBy: null })
          .where(eq(bomItemsTable.id, parseInt(idParam)));
        break;
      case "session":
        await db
          .update(sessionsTable)
          .set({ deletedAt: null, deletedBy: null })
          .where(eq(sessionsTable.id, parseInt(idParam)));
        break;
      default:
        return res.status(400).json({ error: "Invalid type" });
    }

    req.log.info(`Recovered ${typeParam} ${idParam} by ${userId}`);
    return res.json({ success: true, message: `${typeParam} recovered successfully` });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to recover item" });
  }
});

// Permanently delete an item
router.delete("/trash/:type/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const typeParam = req.params.type as string;
    const idParam = req.params.id as string;
    const userId = req.actor?.username || "unknown";

    switch (typeParam) {
      case "bom":
        // Delete all related items first
        await db
          .delete(bomItemsTable)
          .where(eq(bomItemsTable.bomId, parseInt(idParam)));
        await db.delete(bomsTable).where(eq(bomsTable.id, parseInt(idParam)));
        break;
      case "bom_item":
        await db
          .delete(bomItemsTable)
          .where(eq(bomItemsTable.id, parseInt(idParam)));
        break;
      case "session":
        // Delete all related scan records first
        await db
          .delete(scanRecordsTable)
          .where(eq(scanRecordsTable.sessionId, parseInt(idParam)));
        await db
          .delete(sessionsTable)
          .where(eq(sessionsTable.id, parseInt(idParam)));
        break;
      default:
        return res.status(400).json({ error: "Invalid type" });
    }

    req.log.info(`Permanently deleted ${typeParam} ${idParam} by ${userId}`);
    return res.json({
      success: true,
      message: `${typeParam} permanently deleted`,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to delete item" });
  }
});

// Empty trash (delete all expired items)
router.post("/trash/empty", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const retentionDaysParam = req.body.retentionDays;
    const retentionDays = typeof retentionDaysParam === "string" 
      ? parseInt(retentionDaysParam) 
      : retentionDaysParam || 30;
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const userId = req.actor?.username || "unknown";

    // Delete expired BOMs
    const expiredBoms = await db
      .select({ id: bomsTable.id })
      .from(bomsTable)
      .where(
        and(
          isNotNull(bomsTable.deletedAt),
          lt(bomsTable.deletedAt, cutoffDate as any)
        )
      );

    for (const bom of expiredBoms) {
      await db
        .delete(bomItemsTable)
        .where(eq(bomItemsTable.bomId, bom.id));
      await db.delete(bomsTable).where(eq(bomsTable.id, bom.id));
    }

    // Delete expired BOM items
    await db
      .delete(bomItemsTable)
      .where(
        and(
          isNotNull(bomItemsTable.deletedAt),
          lt(bomItemsTable.deletedAt, cutoffDate as any)
        )
      );

    // Delete expired sessions
    const expiredSessions = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(
        and(
          isNotNull(sessionsTable.deletedAt),
          lt(sessionsTable.deletedAt, cutoffDate as any)
        )
      );

    for (const session of expiredSessions) {
      await db
        .delete(scanRecordsTable)
        .where(eq(scanRecordsTable.sessionId, session.id));
      await db
        .delete(sessionsTable)
        .where(eq(sessionsTable.id, session.id));
    }

    req.log.info(
      `Emptied trash (${expiredBoms.length} BOMs, ${expiredSessions.length} sessions) by ${userId}`
    );
    return res.json({
      success: true,
      message: "Trash emptied",
      deletedCount: expiredBoms.length + expiredSessions.length,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to empty trash" });
  }
});

export default router;
