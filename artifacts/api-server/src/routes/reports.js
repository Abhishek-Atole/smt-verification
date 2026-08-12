import { Router } from "express";
import { db } from "@workspace/db";
import { reportsTable, reportExportsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { ReportService } from "../services/report-service";
import { ExportService } from "../services/export-service";
const router = Router();
/**
 * Middleware to validate date filters
 */
function validateDateFilters(req, res, next) {
    const { startDate, endDate, dateFilter } = req.query;
    if (!dateFilter && (!startDate || !endDate)) {
        return res.status(400).json({
            error: "Either dateFilter (today/yesterday/last7/last30) or both startDate and endDate are required",
        });
    }
    // Validate date format if provided
    if (startDate && typeof startDate === "string") {
        const date = new Date(startDate);
        if (isNaN(date.getTime())) {
            return res.status(400).json({
                error: "Invalid startDate format. Use ISO 8601 (YYYY-MM-DD) or valid date string",
            });
        }
    }
    if (endDate && typeof endDate === "string") {
        const date = new Date(endDate);
        if (isNaN(date.getTime())) {
            return res.status(400).json({
                error: "Invalid endDate format. Use ISO 8601 (YYYY-MM-DD) or valid date string",
            });
        }
    }
    next();
}
/**
 * GET /api/reports/fpy - First Pass Yield Report
 */
router.get("/reports/fpy", validateDateFilters, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
            dateFilter: req.query.dateFilter,
            lineId: req.query.line,
            pcbId: req.query.pcb,
            operatorId: req.query.operator,
            shiftId: req.query.shift,
        };
        const startTime = Date.now();
        const data = await ReportService.generateFPYReport(filters);
        const queryTime = Date.now() - startTime;
        return res.json({
            report: data,
            metadata: {
                generatedAt: new Date(),
                queryTimeMs: queryTime,
                recordCount: data.length,
            },
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to generate FPY report" });
    }
});
/**
 * GET /api/reports/oee - OEE Report
 */
router.get("/reports/oee", validateDateFilters, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
            dateFilter: req.query.dateFilter,
            lineId: req.query.line,
            pcbId: req.query.pcb,
            operatorId: req.query.operator,
            shiftId: req.query.shift,
        };
        const startTime = Date.now();
        const data = await ReportService.generateOEEReport(filters);
        const queryTime = Date.now() - startTime;
        return res.json({
            report: data,
            metadata: {
                generatedAt: new Date(),
                queryTimeMs: queryTime,
                recordCount: data.length,
            },
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to generate OEE report" });
    }
});
/**
 * GET /api/reports/operator - Operator Performance Report
 */
router.get("/reports/operator", validateDateFilters, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
            dateFilter: req.query.dateFilter,
            lineId: req.query.line,
            pcbId: req.query.pcb,
            operatorId: req.query.operator,
            shiftId: req.query.shift,
        };
        const startTime = Date.now();
        const data = await ReportService.generateOperatorReport(filters);
        const queryTime = Date.now() - startTime;
        return res.json({
            report: data,
            metadata: {
                generatedAt: new Date(),
                queryTimeMs: queryTime,
                recordCount: data.length,
            },
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to generate operator performance report" });
    }
});
/**
 * GET /api/reports/operator-comparison - Operator Comparison Report
 */
router.get("/reports/operator-comparison", validateDateFilters, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
            dateFilter: req.query.dateFilter,
            lineId: req.query.line,
            pcbId: req.query.pcb,
        };
        const startTime = Date.now();
        const data = await ReportService.generateOperatorComparisonReport(filters);
        const queryTime = Date.now() - startTime;
        return res.json({
            report: data,
            metadata: {
                generatedAt: new Date(),
                queryTimeMs: queryTime,
                recordCount: data.operators.length,
            },
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to generate operator comparison report" });
    }
});
/**
 * GET /api/reports/feeder - Feeder Performance Report
 */
router.get("/reports/feeder", validateDateFilters, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
            dateFilter: req.query.dateFilter,
            lineId: req.query.line,
            pcbId: req.query.pcb,
        };
        const startTime = Date.now();
        const data = await ReportService.generateFeederReport(filters);
        const queryTime = Date.now() - startTime;
        return res.json({
            report: data,
            metadata: {
                generatedAt: new Date(),
                queryTimeMs: queryTime,
                recordCount: data.length,
            },
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to generate feeder performance report" });
    }
});
/**
 * GET /api/reports/feeder-reliability - Feeder Reliability Report
 */
router.get("/reports/feeder-reliability", validateDateFilters, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
            dateFilter: req.query.dateFilter,
        };
        const startTime = Date.now();
        const data = await ReportService.generateFeederReliabilityReport(filters);
        const queryTime = Date.now() - startTime;
        return res.json({
            report: data,
            metadata: {
                generatedAt: new Date(),
                queryTimeMs: queryTime,
                recordCount: data.length,
            },
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to generate feeder reliability report" });
    }
});
/**
 * GET /api/reports/alarm - Alarm Report
 */
router.get("/reports/alarm", validateDateFilters, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
            dateFilter: req.query.dateFilter,
        };
        const startTime = Date.now();
        const data = await ReportService.generateAlarmReport(filters);
        const queryTime = Date.now() - startTime;
        return res.json({
            report: data,
            metadata: {
                generatedAt: new Date(),
                queryTimeMs: queryTime,
                recordCount: data.length,
            },
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to generate alarm report" });
    }
});
/**
 * GET /api/reports/error-analysis - Error Analysis Report
 */
router.get("/reports/error-analysis", validateDateFilters, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
            dateFilter: req.query.dateFilter,
        };
        const startTime = Date.now();
        const data = await ReportService.generateErrorAnalysisReport(filters);
        const queryTime = Date.now() - startTime;
        return res.json({
            report: data,
            metadata: {
                generatedAt: new Date(),
                queryTimeMs: queryTime,
                recordCount: data.length,
            },
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to generate error analysis report" });
    }
});
/**
 * GET /api/reports/component - Component Usage Report
 */
router.get("/reports/component", validateDateFilters, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
            dateFilter: req.query.dateFilter,
        };
        const startTime = Date.now();
        const data = await ReportService.generateComponentReport(filters);
        const queryTime = Date.now() - startTime;
        return res.json({
            report: data,
            metadata: {
                generatedAt: new Date(),
                queryTimeMs: queryTime,
                recordCount: data.length,
            },
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to generate component usage report" });
    }
});
/**
 * GET /api/reports/lot-traceability - Lot Traceability Report
 */
router.get("/reports/lot-traceability", validateDateFilters, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
            dateFilter: req.query.dateFilter,
        };
        const startTime = Date.now();
        const data = await ReportService.generateLotTraceabilityReport(filters);
        const queryTime = Date.now() - startTime;
        return res.json({
            report: data,
            metadata: {
                generatedAt: new Date(),
                queryTimeMs: queryTime,
                recordCount: data.length,
            },
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to generate lot traceability report" });
    }
});
/**
 * GET /api/reports/trend - Trend Report
 */
router.get("/reports/trend", validateDateFilters, async (req, res) => {
    try {
        const filters = {
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
            dateFilter: req.query.dateFilter,
        };
        const startTime = Date.now();
        const data = await ReportService.generateTrendReport(filters);
        const queryTime = Date.now() - startTime;
        return res.json({
            report: data,
            metadata: {
                generatedAt: new Date(),
                queryTimeMs: queryTime,
                recordCount: data.length,
            },
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to generate trend report" });
    }
});
/**
 * POST /api/reports/export/:reportType - Export report to PDF/Excel/CSV
 */
router.post("/reports/export/:reportType", async (req, res) => {
    try {
        const { reportType } = req.params;
        const { format = "pdf", filters } = req.body;
        // Validate report type
        const validReportTypes = [
            "fpy",
            "oee",
            "operator",
            "operator-comparison",
            "feeder",
            "feeder-reliability",
            "alarm",
            "error-analysis",
            "component",
            "lot-traceability",
            "trend",
        ];
        if (!validReportTypes.includes(reportType)) {
            return res.status(400).json({ error: "Invalid report type" });
        }
        if (!["pdf", "xlsx", "csv"].includes(format)) {
            return res.status(400).json({ error: "Invalid export format. Use: pdf, xlsx, or csv" });
        }
        // Generate the report data based on type
        let reportData = [];
        const startTime = Date.now();
        switch (reportType) {
            case "fpy":
                reportData = await ReportService.generateFPYReport(filters);
                break;
            case "oee":
                reportData = await ReportService.generateOEEReport(filters);
                break;
            case "operator":
                reportData = await ReportService.generateOperatorReport(filters);
                break;
            case "operator-comparison":
                reportData = await ReportService.generateOperatorComparisonReport(filters);
                reportData = reportData.operators; // Flatten operators array
                break;
            case "feeder":
                reportData = await ReportService.generateFeederReport(filters);
                break;
            case "feeder-reliability":
                reportData = await ReportService.generateFeederReliabilityReport(filters);
                break;
            case "alarm":
                reportData = await ReportService.generateAlarmReport(filters);
                break;
            case "error-analysis":
                reportData = await ReportService.generateErrorAnalysisReport(filters);
                break;
            case "component":
                reportData = await ReportService.generateComponentReport(filters);
                break;
            case "lot-traceability":
                reportData = await ReportService.generateLotTraceabilityReport(filters);
                break;
            case "trend":
                reportData = await ReportService.generateTrendReport(filters);
                break;
        }
        const queryTime = Date.now() - startTime;
        // Export based on format
        let filePath;
        const exportOptions = {
            reportType,
            format: format,
        };
        switch (format) {
            case "pdf":
                filePath = await ExportService.exportToPdf(reportData, exportOptions, req.user?.id || "system");
                break;
            case "xlsx":
                filePath = await ExportService.exportToExcel(reportData, exportOptions, req.user?.id || "system");
                break;
            case "csv":
                filePath = await ExportService.exportToCsv(reportData, exportOptions, req.user?.id || "system");
                break;
            default:
                throw new Error("Invalid export format");
        }
        // Save report metadata to database
        const [reportRecord] = await db
            .insert(reportsTable)
            .values({
            reportType,
            sessionId: null,
            bomId: null,
            format,
            filePath,
            filters: filters ?? {},
            recordCount: Array.isArray(reportData) ? reportData.length : 0,
            queryTimeMs: queryTime,
            generatedBy: req.user?.id || "system",
        })
            .returning({ id: reportsTable.id });
        // Record export in audit table
        if (reportRecord?.id) {
            await ExportService.recordExport(reportRecord.id, req.user?.id || "system", format, req.ip, req.get("user-agent"));
        }
        return res.json({
            success: true,
            filePath,
            format,
            recordCount: Array.isArray(reportData) ? reportData.length : 0,
            queryTimeMs: queryTime,
            generatedAt: new Date(),
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to export report" });
    }
});
/**
 * GET /api/reports/exports/history - Get user's export history
 */
router.get("/reports/exports/history", async (req, res) => {
    try {
        const userId = req.user?.id || "system";
        const exports = await db.select().from(reportExportsTable).where(eq(reportExportsTable.userId, userId));
        return res.json({
            exports: exports,
            count: exports.length,
        });
    }
    catch (err) {
        req.log.error(err);
        return res.status(500).json({ error: "Failed to get export history" });
    }
});
export default router;
