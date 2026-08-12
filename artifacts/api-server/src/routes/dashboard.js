/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from "express";
import { db } from "@workspace/db";
import { sessionsTable, scanRecordsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
const router = Router();
// Dashboard KPI endpoint
router.get("/dashboard/kpi", async (req, res) => {
    try {
        const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;
        const scans = (sessionId
            ? await db.select().from(scanRecordsTable).where(eq(scanRecordsTable.sessionId, sessionId))
            : await db.select().from(scanRecordsTable))
            .slice()
            .sort((a, b) => new Date(a.scannedAt).getTime() - new Date(b.scannedAt).getTime());
        const totalScans = scans.length;
        const passScans = scans.filter((s) => s.validationResult === "pass").length;
        const mismatchScans = scans.filter((s) => s.validationResult === "mismatch").length;
        const alternatePasses = scans.filter((s) => s.validationResult === "alternate_pass").length;
        const passRate = totalScans > 0 ? Math.round((passScans / totalScans) * 100 * 10) / 10 : 0;
        const defectRate = totalScans > 0 ? Math.round(((mismatchScans) / totalScans) * 100 * 10) / 10 : 0;
        // Calculate cycle time in seconds — guard against single-scan case
        let avgCycleTime = 0;
        if (scans.length >= 2) {
            let totalSeconds = 0;
            for (let i = 1; i < scans.length; i++) {
                const prev = new Date(scans[i - 1].scannedAt).getTime();
                const curr = new Date(scans[i].scannedAt).getTime();
                totalSeconds += (curr - prev) / 1000;
            }
            avgCycleTime = Math.round(totalSeconds / (scans.length - 1));
        }
        // Get unique operators (if tracking available)
        const operators = 1; // Default to 1 operator since operatorId not tracked per scan record
        return res.json({
            totalScans,
            passRate,
            defectRate,
            passScanCount: passScans,
            mismatchCount: mismatchScans,
            alternatePassCount: alternatePasses,
            avgCycleTime,
            uniqueOperators: operators,
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get dashboard KPI" });
    }
});
// Dashboard verification table
router.get("/dashboard/verification", async (req, res) => {
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
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get verification records" });
    }
});
// Dashboard alarm panel
router.get("/dashboard/alarms", async (req, res) => {
    try {
        const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;
        const mismatchConditions = [eq(scanRecordsTable.validationResult, "mismatch")];
        if (sessionId) {
            mismatchConditions.push(eq(scanRecordsTable.sessionId, sessionId));
        }
        const mismatchScans = await db
            .select()
            .from(scanRecordsTable)
            .where(and(...mismatchConditions));
        // Group by feeder to find problematic feeders
        const feederMap = new Map();
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
            const entry = feederMap.get(key);
            entry.mismatchCount++;
            if (scan.partNumber)
                entry.partNumbers.add(scan.partNumber);
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
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get alarm data" });
    }
});
// Dashboard operator metrics (shows feeder operators or summary stats)
router.get("/dashboard/operator", async (req, res) => {
    try {
        const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;
        // @ts-ignore - Drizzle query builder type inference issue
        let query = db.select().from(scanRecordsTable);
        if (sessionId) {
            query = query.where(eq(scanRecordsTable.sessionId, sessionId));
        }
        const scans = await query;
        // Since operatorId is not tracked per scan, provide session-level operator metrics
        const totalScans = scans.length;
        const passCount = scans.filter((s) => s.validationResult === "pass").length;
        const defectCount = scans.filter((s) => s.validationResult === "mismatch").length;
        const alternatePassCount = scans.filter((s) => s.validationResult === "alternate_pass").length;
        // Return feeder-based performance which correlates with operator quality
        const feederMap = new Map();
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
            const entry = feederMap.get(feederNum);
            entry.scanCount++;
            if (scan.validationResult === "pass")
                entry.passCount++;
            if (scan.validationResult === "mismatch")
                entry.defectCount++;
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
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get operator metrics" });
    }
});
// Dashboard time analysis
router.get("/dashboard/time-analysis", async (req, res) => {
    try {
        const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;
        // @ts-ignore - Drizzle query builder type inference issue
        let query = db.select().from(scanRecordsTable);
        if (sessionId) {
            query = query.where(eq(scanRecordsTable.sessionId, sessionId));
        }
        const scans = await query;
        // Group scans by hour
        const hourlyMap = new Map();
        for (const scan of scans) {
            const hour = new Date(scan.scannedAt).getHours();
            if (!hourlyMap.has(hour)) {
                hourlyMap.set(hour, { hour, scanCount: 0, passCount: 0, defectCount: 0 });
            }
            const entry = hourlyMap.get(hour);
            entry.scanCount++;
            if (scan.validationResult === "pass")
                entry.passCount++;
            if (scan.validationResult === "mismatch")
                entry.defectCount++;
        }
        const timeline = Array.from({ length: 24 }, (_, i) => i)
            .map((hour) => {
            const entry = hourlyMap.get(hour);
            return {
                hour: `${hour.toString().padStart(2, "0")}:00`,
                scanCount: entry?.scanCount || 0,
                passRate: entry && entry.scanCount > 0 ? Math.round((entry.passCount / entry.scanCount) * 100 * 10) / 10 : 0,
                defectRate: entry && entry.scanCount > 0 ? Math.round((entry.defectCount / entry.scanCount) * 100 * 10) / 10 : 0,
            };
        });
        return res.json({ timeline });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get time analysis" });
    }
});
// Dashboard feeder analysis
router.get("/dashboard/feeder-analysis", async (req, res) => {
    try {
        const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;
        // @ts-ignore - Drizzle query builder type inference issue
        let query = db.select().from(scanRecordsTable);
        if (sessionId) {
            query = query.where(eq(scanRecordsTable.sessionId, sessionId));
        }
        const scans = await query;
        // Group by feeder
        const feederMap = new Map();
        for (const scan of scans) {
            const feederNum = scan.feederNumber;
            if (!feederMap.has(feederNum)) {
                feederMap.set(feederNum, {
                    feederNumber: feederNum,
                    scanCount: 0,
                    passCount: 0,
                    defectCount: 0,
                    partNumbers: new Set(),
                });
            }
            const entry = feederMap.get(feederNum);
            entry.scanCount++;
            if (scan.validationResult === "pass")
                entry.passCount++;
            if (scan.validationResult === "mismatch")
                entry.defectCount++;
            if (scan.partNumber)
                entry.partNumbers.add(scan.partNumber);
        }
        const feeders = [...feederMap.values()]
            .map((f) => ({
            feederNumber: f.feederNumber,
            scanCount: f.scanCount,
            passCount: f.passCount,
            defectCount: f.defectCount,
            passRate: f.scanCount > 0 ? Math.round((f.passCount / f.scanCount) * 100 * 10) / 10 : 0,
            defectRate: f.scanCount > 0 ? Math.round((f.defectCount / f.scanCount) * 100 * 10) / 10 : 0,
            partCount: f.partNumbers.size,
        }))
            .sort((a, b) => b.defectCount - a.defectCount);
        return res.json({
            feeders,
            totalFeeders: feeders.length,
            problematicFeeders: feeders.filter((f) => f.defectRate > 5).length,
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get feeder analysis" });
    }
});
// Dashboard component analysis
router.get("/dashboard/component-analysis", async (req, res) => {
    try {
        const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;
        // @ts-ignore - Drizzle query builder type inference issue
        let query = db.select().from(scanRecordsTable);
        if (sessionId) {
            query = query.where(eq(scanRecordsTable.sessionId, sessionId));
        }
        const scans = await query;
        // Group by part number / component
        const componentMap = new Map();
        for (const scan of scans) {
            const partNum = scan.partNumber || "unknown";
            if (!componentMap.has(partNum)) {
                componentMap.set(partNum, {
                    partNumber: partNum,
                    description: scan.description || null,
                    scanCount: 0,
                    passCount: 0,
                    defectCount: 0,
                });
            }
            const entry = componentMap.get(partNum);
            entry.scanCount++;
            if (scan.validationResult === "pass")
                entry.passCount++;
            if (scan.validationResult === "mismatch")
                entry.defectCount++;
        }
        const components = [...componentMap.values()]
            .map((c) => ({
            partNumber: c.partNumber,
            description: c.description,
            scanCount: c.scanCount,
            passCount: c.passCount,
            defectCount: c.defectCount,
            passRate: c.scanCount > 0 ? Math.round((c.passCount / c.scanCount) * 100 * 10) / 10 : 0,
            defectRate: c.scanCount > 0 ? Math.round((c.defectCount / c.scanCount) * 100 * 10) / 10 : 0,
        }))
            .sort((a, b) => b.defectCount - a.defectCount)
            .slice(0, 50);
        return res.json({
            components,
            totalComponentTypes: componentMap.size,
            problematicComponents: components.filter((c) => c.defectRate > 5).length,
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get component analysis" });
    }
});
// Dashboard traceability
router.get("/dashboard/traceability/:panelId", async (req, res) => {
    try {
        const { panelId } = req.params;
        // Find scans matching this feeder or component ID
        const allScans = await db.select().from(scanRecordsTable);
        // Filter by panelId (can be feederNumber, feeder_id, or component_id)
        const panelScans = allScans.filter((scan) => scan.feederNumber === panelId ||
            String(scan.feederId) === panelId ||
            String(scan.componentId) === panelId);
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
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get traceability data" });
    }
});
// Dashboard efficiency
router.get("/dashboard/efficiency", async (req, res) => {
    try {
        const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null;
        // Get session info
        // @ts-ignore - Drizzle query builder type inference issue
        let sessionQuery = db.select().from(sessionsTable);
        if (sessionId) {
            sessionQuery = sessionQuery.where(eq(sessionsTable.id, sessionId));
        }
        const sessions = await sessionQuery;
        const sessionInfo = sessions.length > 0 ? sessions[0] : null;
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
            const scans = await db
                .select()
                .from(scanRecordsTable)
                .where(eq(scanRecordsTable.sessionId, sessionInfo.id));
            efficiencyData.throughput =
                efficiencyData.elapsedMinutes > 0
                    ? Math.round((scans.length / efficiencyData.elapsedMinutes) * 10) / 10
                    : 0;
            const expectedScansPerMinute = 5; // Benchmark
            efficiencyData.efficiency =
                expectedScansPerMinute > 0
                    ? Math.round((efficiencyData.throughput / expectedScansPerMinute) * 100 * 10) / 10
                    : 0;
        }
        return res.json(efficiencyData);
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get efficiency data" });
    }
});
export default router;
