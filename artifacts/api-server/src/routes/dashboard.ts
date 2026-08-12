import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sessionsTable, scanRecordsTable, spliceRecordsTable } from "@workspace/db/schema";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import { AnalyticsService } from "../services/analytics-service";
import { attachActor, requireRole, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

router.use(attachActor);

// Dashboard KPI endpoint
router.get("/dashboard/kpi", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;

    const scans = await (sessionId
      ? db.select().from(scanRecordsTable).where(eq(scanRecordsTable.sessionId, sessionId))
      : db.select().from(scanRecordsTable));

    const validScans = scans
      .filter(scan => scan.validationResult !== null || scan.status !== null)
      .map(scan => ({
        ...scan,
        validationResult: scan.validationResult || scan.status || null,
      }));

    const kpi = AnalyticsService.calculateKPI(validScans as Array<{ validationResult: string; scannedAt: Date | string }>);

    return res.json({
      totalScans: kpi.totalScans,
      validScans: kpi.validScans,
      fpy: kpi.fpy,
      passRate: kpi.passRate,
      defectRate: kpi.defectRate,
      passScanCount: kpi.passingScans,
      failScanCount: kpi.failingScans,
      mismatchCount: kpi.mismatchCount,
      alternatePassCount: kpi.alternatePassCount,
      avgCycleTime: kpi.avgCycleTime,
      uniqueOperators: 1, // Placeholder - would need operator tracking
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get dashboard KPI" });
  }
});

// Dashboard verification table
router.get("/dashboard/verification", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const scans = await (sessionId
      ? db.select().from(scanRecordsTable).where(eq(scanRecordsTable.sessionId, sessionId))
      : db.select().from(scanRecordsTable));
    
    // Return paginated results with most recent first
    const records = scans
      .sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime())
      .slice(0, limit)
      .map((scan) => ({
        id: scan.id,
        feederNumber: scan.feederNumber,
        partNumber: scan.partNumber,
        description: scan.description,
        validationResult: scan.validationResult,
        status: scan.status,
        scannedAt: scan.scannedAt,
        lotNumber: scan.lotNumber,
        dateCode: scan.dateCode,
        quantity: 1,
      }));

    return res.json({
      records,
      total: scans.length,
      returned: records.length,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get verification records" });
  }
});

// Dashboard alarm panel
router.get("/dashboard/alarms", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;

    let query: any = db.select().from(scanRecordsTable).where(eq(scanRecordsTable.validationResult, "mismatch"));
    if (sessionId) {
      query = query.where(eq(scanRecordsTable.sessionId, sessionId));
    }

    const mismatchScans = await query;

    // Group by feeder to find problematic feeders
    const feederMap = new Map<
      string,
      { feederNumber: string; mismatchCount: number; lastOccurrence: Date; partNumbers: Set<string> }
    >();

    for (const scan of mismatchScans) {
      const key = scan.feederNumber;
      if (!feederMap.has(key)) {
        feederMap.set(key, {
          feederNumber: key,
          mismatchCount: 0,
          lastOccurrence: new Date(scan.scannedAt),
          partNumbers: new Set(),
        });
      }
      const entry = feederMap.get(key)!;
      entry.mismatchCount++;
      if (scan.partNumber) entry.partNumbers.add(scan.partNumber);
      const scanDate = new Date(scan.scannedAt);
      if (scanDate > entry.lastOccurrence) {
        entry.lastOccurrence = scanDate;
      }
    }

    const alarms = [...feederMap.values()]
      .sort((a, b) => b.mismatchCount - a.mismatchCount)
      .map((feeder) => ({
        feederNumber: feeder.feederNumber,
        severity: feeder.mismatchCount > 10 ? "critical" : feeder.mismatchCount > 5 ? "warning" : "info",
        mismatchCount: feeder.mismatchCount,
        lastOccurrence: feeder.lastOccurrence,
        affectedParts: Array.from(feeder.partNumbers),
      }));

    return res.json({
      alarms,
      totalMismatches: mismatchScans.length,
      activeAlarms: alarms.length,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get alarm data" });
  }
});

// Dashboard operator metrics (shows feeder operators or summary stats)
router.get("/dashboard/operator", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;

    // @ts-ignore - Drizzle query builder type inference issue
    let query: any = db.select().from(scanRecordsTable);
    if (sessionId) {
      query = query.where(eq(scanRecordsTable.sessionId, sessionId));
    }

    const scans = await query;

    // Since operatorId is not tracked per scan, provide session-level operator metrics
    const totalScans = scans.length;
    const passCount = scans.filter((s: any) => s.validationResult === "pass").length;
    const defectCount = scans.filter((s: any) => s.validationResult === "mismatch").length;
    const alternatePassCount = scans.filter((s: any) => s.validationResult === "alternate_pass").length;

    // Return feeder-based performance which correlates with operator quality
    const feederMap = new Map<
      string,
      { feederNumber: string; scanCount: number; passCount: number; defectCount: number }
    >();

    for (const scan of scans) {
      const feederNum = scan.feederNumber;
      if (!feederMap.has(feederNum)) {
        feederMap.set(feederNum, {
          feederNumber: feederNum,
          scanCount: 0,
          passCount: 0,
          defectCount: 0,
        });
      }
      const entry = feederMap.get(feederNum)!;
      entry.scanCount++;
      if (scan.validationResult === "pass") entry.passCount++;
      if (scan.validationResult === "mismatch") entry.defectCount++;
    }

    const operators = [...feederMap.values()]
      .map((op) => ({
        operatorId: op.feederNumber,
        scanCount: op.scanCount,
        passCount: op.passCount,
        defectCount: op.defectCount,
        passRate: op.scanCount > 0 ? Math.round((op.passCount / op.scanCount) * 100 * 10) / 10 : 0,
        defectRate: op.scanCount > 0 ? Math.round((op.defectCount / op.scanCount) * 100 * 10) / 10 : 0,
      }))
      .sort((a, b) => b.scanCount - a.scanCount);

    return res.json({
      operators,
      totalOperators: operators.length,
      sessionStats: {
        totalScans,
        passCount,
        defectCount,
        alternatePassCount,
      },
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get operator metrics" });
  }
});

// Dashboard time analysis
router.get("/dashboard/time-analysis", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;

    const scans = await (sessionId
      ? db.select().from(scanRecordsTable).where(eq(scanRecordsTable.sessionId, sessionId))
      : db.select().from(scanRecordsTable));

    const validScans = scans.filter(scan => scan.validationResult !== null);

    const hourlyMetrics = AnalyticsService.aggregateByHour(validScans as Array<{ scannedAt: Date | string; validationResult: string }>);

    const timeline = hourlyMetrics.map((entry) => ({
      hour: `${entry.hour.toString().padStart(2, "0")}:00`,
      scanCount: entry.scanCount,
      passRate: entry.passRate,
      defectRate: entry.defectRate,
    }));

    return res.json({ timeline });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get time analysis" });
  }
});

// Dashboard feeder analysis
router.get("/dashboard/feeder-analysis", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;

    const scans = await (sessionId
      ? db.select().from(scanRecordsTable).where(eq(scanRecordsTable.sessionId, sessionId))
      : db.select().from(scanRecordsTable));

    const validScans = scans.filter(scan => scan.validationResult !== null);

    const feederMetrics = AnalyticsService.aggregateByFeeder(validScans as Array<{ feederNumber: string; partNumber: string | null; validationResult: string }>);

    const feeders = [...feederMetrics.values()]
      .map((f) => ({
        feederNumber: f.feederNumber,
        scanCount: f.scanCount,
        passCount: f.passCount,
        defectCount: f.defectCount,
        passRate: f.passRate,
        defectRate: f.defectRate,
        partCount: f.partNumbers.size,
      }))
      .sort((a, b) => b.defectCount - a.defectCount);

    return res.json({
      feeders,
      totalFeeders: feeders.length,
      problematicFeeders: feeders.filter((f) => f.defectRate > 5).length,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get feeder analysis" });
  }
});

// Dashboard component analysis
router.get("/dashboard/component-analysis", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;

    const scans = await (sessionId
      ? db.select().from(scanRecordsTable).where(eq(scanRecordsTable.sessionId, sessionId))
      : db.select().from(scanRecordsTable));
    const validScans = scans.filter(scan => scan.validationResult !== null);
    const componentMetrics = AnalyticsService.aggregateByComponent(validScans as Array<{ partNumber: string | null; description: string | null; validationResult: string }>);

    const components = [...componentMetrics.values()]
      .map((c) => ({
        partNumber: c.partNumber,
        description: c.description,
        scanCount: c.scanCount,
        passCount: c.passCount,
        defectCount: c.defectCount,
        passRate: c.passRate,
        defectRate: c.defectRate,
      }))
      .sort((a, b) => b.defectCount - a.defectCount)
      .slice(0, 50);

    return res.json({
      components,
      totalComponentTypes: componentMetrics.size,
      problematicComponents: components.filter((c) => c.defectRate > 5).length,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get component analysis" });
  }
});

// Dashboard traceability
router.get("/dashboard/traceability/:panelId", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { panelId } = req.params;

    // Find scans matching this feeder or component ID
    const allScans = await db.select().from(scanRecordsTable);
    
    // Filter by panelId (can be feederNumber, feeder_id, or component_id)
    const panelScans = allScans.filter((scan) => 
      scan.feederNumber === panelId || 
      String(scan.feederId) === panelId ||
      String(scan.componentId) === panelId
    );

    const traceability = panelScans.map((scan) => ({
      feederNumber: scan.feederNumber,
      partNumber: scan.partNumber,
      description: scan.description,
      validationResult: scan.validationResult,
      status: scan.status,
      scannedAt: scan.scannedAt,
      lotNumber: scan.lotNumber,
      dateCode: scan.dateCode,
      sessionId: scan.sessionId,
    }));

    const passingComponents = traceability.filter((t) => t.validationResult === "pass").length;
    const defectiveComponents = traceability.filter((t) => t.validationResult === "mismatch").length;
    const alternatePassComponents = traceability.filter((t) => t.validationResult === "alternate_pass").length;

    return res.json({
      panelId,
      totalComponents: traceability.length,
      passingComponents,
      defectiveComponents,
      alternatePassComponents,
      components: traceability,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get traceability data" });
  }
});

// Dashboard efficiency
router.get("/dashboard/efficiency", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;

    // Get session info
    const sessionQuery = sessionId
      ? await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId))
      : await db.select().from(sessionsTable);

    const sessionInfo = sessionQuery.length > 0 ? sessionQuery[0] : null;

    // Calculate efficiency metrics
    let efficiencyData = {
      sessionId: sessionId || null,
      sessionStatus: sessionInfo?.status || "unknown",
      totalDurationMinutes: 0,
      elapsedMinutes: 0,
      remainingMinutes: 0,
      throughput: 0, // scans per minute
      efficiency: 0, // percentage
    };

    if (sessionInfo) {
      const start = new Date(sessionInfo.startTime);
      const end = sessionInfo.endTime ? new Date(sessionInfo.endTime) : new Date();
      const durationMs = end.getTime() - start.getTime();
      efficiencyData.totalDurationMinutes = Math.round(durationMs / 60000);
      efficiencyData.elapsedMinutes = efficiencyData.totalDurationMinutes;

      // Get scans for this session
      const scans = await db.select().from(scanRecordsTable).where(eq(scanRecordsTable.sessionId, sessionInfo.id));

      efficiencyData.throughput = AnalyticsService.calculateThroughput(scans.length, efficiencyData.elapsedMinutes);

      const expectedScansPerMinute = 5; // Benchmark
      efficiencyData.efficiency =
        expectedScansPerMinute > 0
          ? Math.round((efficiencyData.throughput / expectedScansPerMinute) * 100 * 10) / 10
          : 0;
    }

    return res.json(efficiencyData);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get efficiency data" });
  }
});

router.get("/dashboard/splice-stats", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const [totals] = await db
      .select({
        total: sql<number>`count(*)::int`,
        last7d: sql<number>`count(*) filter (where ${spliceRecordsTable.splicedAt} >= now() - interval '7 days')::int`,
        last30d: sql<number>`count(*) filter (where ${spliceRecordsTable.splicedAt} >= now() - interval '30 days')::int`,
        avgDuration: sql<number>`coalesce(avg(${spliceRecordsTable.durationSeconds}), 0)::float`,
      })
      .from(spliceRecordsTable);

    const byMatchField = await db
      .select({
        field: spliceRecordsTable.newSpoolMatchedField,
        count: sql<number>`count(*)::int`,
      })
      .from(spliceRecordsTable)
      .groupBy(spliceRecordsTable.newSpoolMatchedField)
      .orderBy(desc(sql`count(*)`));

    const dailyTrend = await db
      .select({
        day: sql<string>`to_char(${spliceRecordsTable.splicedAt}, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(spliceRecordsTable)
      .where(gte(spliceRecordsTable.splicedAt, sql`now() - interval '14 days'`))
      .groupBy(sql`to_char(${spliceRecordsTable.splicedAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${spliceRecordsTable.splicedAt}, 'YYYY-MM-DD')`);

    res.json({
      total: totals?.total ?? 0,
      last7d: totals?.last7d ?? 0,
      last30d: totals?.last30d ?? 0,
      avgDurationSeconds: Math.round(totals?.avgDuration ?? 0),
      byMatchField: byMatchField.map((r) => ({ field: r.field ?? "unknown", count: r.count })),
      dailyTrend,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get splice stats" });
  }
});

export default router;
