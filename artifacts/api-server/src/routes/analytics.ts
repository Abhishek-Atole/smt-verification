import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sessionsTable, scanRecordsTable, bomItemsTable, bomsTable } from "@workspace/db/schema";
import { eq, sql, and, gte } from "drizzle-orm";
import { attachActor, requireRole, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

router.use(attachActor);

router.get("/analytics/overview", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    // Independent reads — run concurrently instead of three serial round-trips.
    const [sessions, scans, boms] = await Promise.all([
      db.select().from(sessionsTable),
      db.select().from(scanRecordsTable),
      db.select().from(bomsTable),
    ]);

    const totalSessions = sessions.length;
    const activeSessions = sessions.filter((s) => s.status === "active").length;
    const completedSessions = sessions.filter((s) => s.status === "completed").length;
    const totalScans = scans.length;
    const totalOk = scans.filter((s) => s.status === "ok").length;
    const totalReject = scans.filter((s) => s.status === "reject").length;
    const overallOkRate = totalScans > 0 ? Math.round((totalOk / totalScans) * 100 * 10) / 10 : 0;
    const totalBoms = boms.length;

    const completedWithEnd = sessions.filter((s) => s.status === "completed" && s.endTime);
    const avgDurationMinutes =
      completedWithEnd.length > 0
        ? Math.round(
            completedWithEnd.reduce((sum, s) => {
              const start = new Date(s.startTime);
              const end = new Date(s.endTime!);
              return sum + (end.getTime() - start.getTime()) / 60000;
            }, 0) / completedWithEnd.length
          )
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get analytics overview" });
  }
});

router.get("/analytics/pareto", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
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
    }

    // Group by feeder number
    const counts = new Map<
      string,
      { feederNumber: string; partNumber: string | null; description: string | null; count: number }
    >();

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
      counts.get(key)!.count++;
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get Pareto data" });
  }
});

router.get("/analytics/trends", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Independent reads — run concurrently instead of two serial round-trips.
    const [sessions, scans] = await Promise.all([
      db
        .select()
        .from(sessionsTable)
        .where(gte(sessionsTable.startTime, thirtyDaysAgo)),
      db.select().from(scanRecordsTable),
    ]);

    // Group sessions by date
    const dateMap = new Map<
      string,
      { sessions: number; totalScans: number; okCount: number; rejectCount: number }
    >();

    for (const session of sessions) {
      const date = new Date(session.startTime).toISOString().split("T")[0];
      if (!dateMap.has(date)) {
        dateMap.set(date, { sessions: 0, totalScans: 0, okCount: 0, rejectCount: 0 });
      }
      const entry = dateMap.get(date)!;
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get trend data" });
  }
});

// Module 8: bypass quantity tracking. A "bypass" is a changeover started with
// BOM verification skipped (Module 1). Reports how many changeovers bypassed
// verification and the production quantity (boards produced — what AOI/SPI
// inspect, not the cavity-multiplied output units) they carried, broken down by
// line and by day so the frontend can render the tracking graphs.
router.get("/analytics/bypass", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessions = await db
      .select({
        id: sessionsTable.id,
        lineName: sessionsTable.lineName,
        skipped: sessionsTable.bomVerificationSkipped,
        productionQuantity: sessionsTable.totalProductionQuantity,
        createdAt: sessionsTable.createdAt,
      })
      .from(sessionsTable)
      .where(sql`${sessionsTable.deletedAt} IS NULL`);

    const totalSessions = sessions.length;
    const bypassed = sessions.filter((s) => s.skipped);
    const totalBypassed = bypassed.length;
    const bypassedProductionQuantity = bypassed.reduce((sum, s) => sum + (s.productionQuantity ?? 0), 0);
    const bypassRate = totalSessions > 0 ? Math.round((totalBypassed / totalSessions) * 100 * 10) / 10 : 0;

    const lineMap = new Map<string, { line: string; bypassed: number; total: number; productionQuantity: number }>();
    for (const s of sessions) {
      const line = s.lineName ?? "Unassigned";
      if (!lineMap.has(line)) lineMap.set(line, { line, bypassed: 0, total: 0, productionQuantity: 0 });
      const entry = lineMap.get(line)!;
      entry.total++;
      if (s.skipped) {
        entry.bypassed++;
        entry.productionQuantity += s.productionQuantity ?? 0;
      }
    }
    const byLine = [...lineMap.values()].sort((a, b) => b.bypassed - a.bypassed);

    const dateMap = new Map<string, { date: string; bypassed: number; productionQuantity: number }>();
    for (const s of bypassed) {
      const date = new Date(s.createdAt).toISOString().split("T")[0];
      if (!dateMap.has(date)) dateMap.set(date, { date, bypassed: 0, productionQuantity: 0 });
      const entry = dateMap.get(date)!;
      entry.bypassed++;
      entry.productionQuantity += s.productionQuantity ?? 0;
    }
    const byDate = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    return res.json({ totalSessions, totalBypassed, bypassedProductionQuantity, bypassRate, byLine, byDate });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get bypass data" });
  }
});

export default router;
