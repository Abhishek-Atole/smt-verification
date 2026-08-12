import { Router } from "express";
import { db } from "@workspace/db";
import { bomsTable, bomItemsTable, sessionsTable, scanRecordsTable } from "@workspace/db/schema";
import { eq, isNotNull, and, or, desc, asc, like, sql, lt } from "drizzle-orm";
const router = Router();
// Get all deleted items (trash bin)
router.get("/trash/items", async (req, res) => {
    try {
        const { type = "all", sortBy = "deletedAt", order = "desc", search = "" } = req.query;
        const offset = parseInt(req.query.offset) || 0;
        const limit = parseInt(req.query.limit) || 20;
        let deletedBoms = [];
        let deletedItems = [];
        let deletedSessions = [];
        let bomCount = 0;
        let itemCount = 0;
        let sessionCount = 0;
        // Get deleted BOMs
        if (type === "all" || type === "bom") {
            const bomResults = await db
                .select()
                .from(bomsTable)
                .where(and(isNotNull(bomsTable.deletedAt), search ? like(bomsTable.name, `%${search}%`) : undefined))
                .orderBy(order === "asc"
                ? asc(bomsTable.deletedAt)
                : desc(bomsTable.deletedAt));
            deletedBoms = bomResults.map((b) => ({
                id: b.id,
                name: b.name,
                description: b.description,
                type: "bom",
                deletedAt: b.deletedAt,
                deletedBy: b.deletedBy,
                createdAt: b.createdAt,
            }));
            bomCount = await db
                .select({ count: sql `count(*)::int` })
                .from(bomsTable)
                .where(isNotNull(bomsTable.deletedAt))
                .then((r) => r[0]?.count || 0);
        }
        // Get deleted BOM items
        if (type === "all" || type === "bom_item") {
            const itemResults = await db
                .select()
                .from(bomItemsTable)
                .where(and(isNotNull(bomItemsTable.deletedAt), search ? like(bomItemsTable.partNumber, `%${search}%`) : undefined))
                .orderBy(order === "asc"
                ? asc(bomItemsTable.deletedAt)
                : desc(bomItemsTable.deletedAt));
            deletedItems = itemResults.map((item) => ({
                id: item.id,
                name: `${item.partNumber} - ${item.description || ""}`,
                partNumber: item.partNumber,
                bomId: item.bomId,
                type: "bom_item",
                deletedAt: item.deletedAt,
                deletedBy: item.deletedBy,
            }));
            itemCount = await db
                .select({ count: sql `count(*)::int` })
                .from(bomItemsTable)
                .where(isNotNull(bomItemsTable.deletedAt))
                .then((r) => r[0]?.count || 0);
        }
        // Get deleted sessions
        if (type === "all" || type === "session") {
            const sessionResults = await db
                .select()
                .from(sessionsTable)
                .where(and(isNotNull(sessionsTable.deletedAt), search
                ? or(like(sessionsTable.panelName, `%${search}%`), like(sessionsTable.companyName, `%${search}%`))
                : undefined))
                .orderBy(order === "asc"
                ? asc(sessionsTable.deletedAt)
                : desc(sessionsTable.deletedAt));
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
            sessionCount = await db
                .select({ count: sql `count(*)::int` })
                .from(sessionsTable)
                .where(isNotNull(sessionsTable.deletedAt))
                .then((r) => r[0]?.count || 0);
        }
        // For `type === "all"` totalCount: aggregate from per-category DB counts (not post-fetch length)
        let totalCount;
        if (type === "bom") totalCount = bomCount;
        else if (type === "bom_item") totalCount = itemCount;
        else if (type === "session") totalCount = sessionCount;
        else totalCount = bomCount + itemCount + sessionCount;

        // Sort + slice the combined array only once with a single pagination
        const sortDir = order === "asc" ? 1 : -1;
        const allItems = [...deletedBoms, ...deletedItems, ...deletedSessions].sort((a, b) => {
            const at = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
            const bt = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
            return (at - bt) * sortDir;
        });

        return res.json({
            items: allItems.slice(offset, offset + limit),
            totalCount,
            offset,
            limit,
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to fetch trash items" });
    }
});
// Get trash statistics
router.get("/trash/stats", async (req, res) => {
    try {
        const bomCount = await db
            .select({ count: sql `count(*)::int` })
            .from(bomsTable)
            .where(isNotNull(bomsTable.deletedAt))
            .then((r) => r[0]?.count || 0);
        const itemCount = await db
            .select({ count: sql `count(*)::int` })
            .from(bomItemsTable)
            .where(isNotNull(bomItemsTable.deletedAt))
            .then((r) => r[0]?.count || 0);
        const sessionCount = await db
            .select({ count: sql `count(*)::int` })
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
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to fetch trash stats" });
    }
});
// Recover a deleted item
router.post("/trash/:type/:id/recover", async (req, res) => {
    try {
        const typeParam = req.params.type;
        const idParam = req.params.id;
        const userId = req.user?.username || "unknown";
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
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to recover item" });
    }
});
// Permanently delete an item
router.delete("/trash/:type/:id", async (req, res) => {
    try {
        const typeParam = req.params.type;
        const idParam = req.params.id;
        const userId = req.user?.username || "unknown";
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
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to delete item" });
    }
});
// Empty trash (delete all expired items)
router.post("/trash/empty", async (req, res) => {
    try {
        const retentionDaysParam = req.body.retentionDays;
        const retentionDays = typeof retentionDaysParam === "string"
            ? parseInt(retentionDaysParam)
            : retentionDaysParam || 30;
        const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        const userId = req.user?.username || "unknown";
        // Delete expired BOMs
        const expiredBoms = await db
            .select({ id: bomsTable.id })
            .from(bomsTable)
            .where(and(isNotNull(bomsTable.deletedAt), lt(bomsTable.deletedAt, cutoffDate)));
        for (const bom of expiredBoms) {
            await db
                .delete(bomItemsTable)
                .where(eq(bomItemsTable.bomId, bom.id));
            await db.delete(bomsTable).where(eq(bomsTable.id, bom.id));
        }
        // === PERFORMANCE: count deleted standalone BOM items before they are lost ===
        const standaloneDeletedItems = await db
            .select({ id: bomItemsTable.id })
            .from(bomItemsTable)
            .where(and(isNotNull(bomItemsTable.deletedAt), lt(bomItemsTable.deletedAt, cutoffDate)));
        const standaloneDeletedItemsCount = standaloneDeletedItems.length;
        await db
            .delete(bomItemsTable)
            .where(and(isNotNull(bomItemsTable.deletedAt), lt(bomItemsTable.deletedAt, cutoffDate)));
        // Delete expired sessions
        const expiredSessions = await db
            .select({ id: sessionsTable.id })
            .from(sessionsTable)
            .where(and(isNotNull(sessionsTable.deletedAt), lt(sessionsTable.deletedAt, cutoffDate)));
        for (const session of expiredSessions) {
            await db
                .delete(scanRecordsTable)
                .where(eq(scanRecordsTable.sessionId, session.id));
            await db
                .delete(sessionsTable)
                .where(eq(sessionsTable.id, session.id));
        }
        req.log.info(`Emptied trash (${expiredBoms.length} BOMs, ${standaloneDeletedItemsCount} standalone items, ${expiredSessions.length} sessions) by ${userId}`);
        return res.json({
            success: true,
            message: "Trash emptied",
            deletedCount: expiredBoms.length + standaloneDeletedItemsCount + expiredSessions.length,
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to empty trash" });
    }
});
export default router;
