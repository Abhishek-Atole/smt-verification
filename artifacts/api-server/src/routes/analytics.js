import { Router } from "express";
import { db } from "@workspace/db";
import { sessionsTable, scanRecordsTable, bomsTable } from "@workspace/db/schema";
import { eq, gte } from "drizzle-orm";
const router = Router();
router.get("/analytics/overview", async (req, res) => {
    try {
        const sessions = await db.select().from(sessionsTable);
        const scans = await db.select().from(scanRecordsTable);
        const boms = await db.select().from(bomsTable);
        const totalSessions = sessions.length;
        const activeSessions = sessions.filter((s) => s.status === "active").length;
        const completedSessions = sessions.filter((s) => s.status === "completed").length;
        const totalScans = scans.length;
        const totalOk = scans.filter((s) => s.status === "ok").length;
        const totalReject = scans.filter((s) => s.status === "reject").length;
        const overallOkRate = totalScans > 0 ? Math.round((totalOk / totalScans) * 100 * 10) / 10 : 0;
        const totalBoms = boms.length;
        const completedWithEnd = sessions.filter((s) => s.status === "completed" && s.endTime);
        const avgDurationMinutes = completedWithEnd.length > 0
            ? Math.round(completedWithEnd.reduce((sum, s) => {
                const start = new Date(s.startTime);
                const end = new Date(s.endTime);
                return sum + (end.getTime() - start.getTime()) / 60000;
            }, 0) / completedWithEnd.length)
            : 0;
        return res.json({
            totalSessions,
            activeSessions,
            completedSessions,
            totalScans,
            totalOk,
            totalReject,
            overallOkRate,
            totalBoms,
            avgDurationMinutes,
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get analytics overview" });
    }
});
router.get("/analytics/pareto", async (req, res) => {
    try {
        const sessionIdParam = req.query.sessionId ? Number(req.query.sessionId) : undefined;
        let rejectScans = await db
            .select()
            .from(scanRecordsTable)
            .where(eq(scanRecordsTable.status, "reject"));
        if (sessionIdParam) {
            rejectScans = rejectScans.filter((s) => s.sessionId === sessionIdParam);
        }
        const totalRejects = rejectScans.length;
        if (totalRejects === 0) {
            return res.json({ items: [], totalRejects: 0 });
            return;
        }
        // Group by feeder number
        const counts = new Map();
        for (const scan of rejectScans) {
            const key = scan.feederNumber;
            if (!counts.has(key)) {
                counts.set(key, {
                    feederNumber: scan.feederNumber,
                    partNumber: scan.partNumber ?? null,
                    description: scan.description ?? null,
                    count: 0,
                });
            }
            counts.get(key).count++;
        }
        // Sort descending by count
        const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
        // Compute cumulative percent
        let cumulative = 0;
        const items = sorted.map((item) => {
            cumulative += item.count;
            return {
                feederNumber: item.feederNumber,
                partNumber: item.partNumber ?? undefined,
                description: item.description ?? undefined,
                rejectCount: item.count,
                cumulativePercent: Math.round((cumulative / totalRejects) * 100 * 10) / 10,
            };
        });
        return res.json({ items, totalRejects });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get Pareto data" });
    }
});
router.get("/analytics/trends", async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const sessions = await db
            .select()
            .from(sessionsTable)
            .where(gte(sessionsTable.startTime, thirtyDaysAgo));
        const scans = await db.select().from(scanRecordsTable);
        // Group sessions by date
        const dateMap = new Map();
        for (const session of sessions) {
            const date = new Date(session.startTime).toISOString().split("T")[0];
            if (!dateMap.has(date)) {
                dateMap.set(date, { sessions: 0, totalScans: 0, okCount: 0, rejectCount: 0 });
            }
            const entry = dateMap.get(date);
            entry.sessions++;
            const sessionScans = scans.filter((s) => s.sessionId === session.id);
            entry.totalScans += sessionScans.length;
            entry.okCount += sessionScans.filter((s) => s.status === "ok").length;
            entry.rejectCount += sessionScans.filter((s) => s.status === "reject").length;
        }
        const result = [...dateMap.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, data]) => ({
            date,
            sessions: data.sessions,
            totalScans: data.totalScans,
            okCount: data.okCount,
            rejectCount: data.rejectCount,
            okRate: data.totalScans > 0 ? Math.round((data.okCount / data.totalScans) * 100 * 10) / 10 : 0,
        }));
        return res.json(result);
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get trend data" });
    }
});
export default router;
