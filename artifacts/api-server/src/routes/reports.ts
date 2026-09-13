import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reportsTable, reportExportsTable, auditLogsTable, bomItemsTable } from "@workspace/db/schema";
import { eq, desc, and, not } from "drizzle-orm";
import { ReportService } from "../services/report-service";
import { ReportFilters } from "../services/filter-service";
import { ExportService } from "../services/export-service";
import { archiveExistingFile } from "../services/report-archive-service";
import { attachActor, requireRole, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

// Protect all routes with role-based access control
router.use(attachActor);
// Reports expose plant-wide analytics (FPY/OEE/operator-performance/etc.) that
// the UI restricts to supervisor/qa. Gate every /reports route so no data
// endpoint is left open to operator/storekeeper — the per-route export gates
// below are now redundant but kept for clarity. NOTE: this MUST be path-scoped
// to "/reports". A path-less router.use(requireRole(...)) runs for every request
// reaching this router (mounted at "/"), and since reportsRouter is mounted
// before verification/notifications/approvers/... in routes/index.ts, an
// unscoped gate 403s operator/storekeeper on those later routers too.
router.use("/reports", requireRole("qa", "supervisor", "admin"));

/**
 * Middleware to validate date filters
 */
function validateDateFilters(req: any, res: any, next: any) {
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
    const filters: ReportFilters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      dateFilter: req.query.dateFilter as any,
      lineId: req.query.line as string,
      pcbId: req.query.pcb as string,
      operatorId: req.query.operator as string,
      shiftId: req.query.shift as string,
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate FPY report" });
  }
});

/**
 * GET /api/reports/oee - OEE Report
 */
router.get("/reports/oee", validateDateFilters, async (req, res) => {
  try {
    const filters: ReportFilters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      dateFilter: req.query.dateFilter as any,
      lineId: req.query.line as string,
      pcbId: req.query.pcb as string,
      operatorId: req.query.operator as string,
      shiftId: req.query.shift as string,
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate OEE report" });
  }
});

/**
 * GET /api/reports/operator - Operator Performance Report
 */
router.get("/reports/operator", validateDateFilters, async (req, res) => {
  try {
    const filters: ReportFilters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      dateFilter: req.query.dateFilter as any,
      lineId: req.query.line as string,
      pcbId: req.query.pcb as string,
      operatorId: req.query.operator as string,
      shiftId: req.query.shift as string,
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate operator performance report" });
  }
});

/**
 * GET /api/reports/operator-comparison - Operator Comparison Report
 */
router.get("/reports/operator-comparison", validateDateFilters, async (req, res) => {
  try {
    const filters: ReportFilters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      dateFilter: req.query.dateFilter as any,
      lineId: req.query.line as string,
      pcbId: req.query.pcb as string,
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate operator comparison report" });
  }
});

/**
 * GET /api/reports/feeder - Feeder Performance Report
 */
router.get("/reports/feeder", validateDateFilters, async (req, res) => {
  try {
    const filters: ReportFilters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      dateFilter: req.query.dateFilter as any,
      lineId: req.query.line as string,
      pcbId: req.query.pcb as string,
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate feeder performance report" });
  }
});

/**
 * GET /api/reports/feeder-reliability - Feeder Reliability Report
 */
router.get("/reports/feeder-reliability", validateDateFilters, async (req, res) => {
  try {
    const filters: ReportFilters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      dateFilter: req.query.dateFilter as any,
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate feeder reliability report" });
  }
});

/**
 * GET /api/reports/alarm - Alarm Report
 */
router.get("/reports/alarm", validateDateFilters, async (req, res) => {
  try {
    const filters: ReportFilters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      dateFilter: req.query.dateFilter as any,
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate alarm report" });
  }
});

/**
 * GET /api/reports/error-analysis - Error Analysis Report
 */
router.get("/reports/error-analysis", validateDateFilters, async (req, res) => {
  try {
    const filters: ReportFilters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      dateFilter: req.query.dateFilter as any,
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate error analysis report" });
  }
});

/**
 * GET /api/reports/component - Component Usage Report
 */
router.get("/reports/component", validateDateFilters, async (req, res) => {
  try {
    const filters: ReportFilters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      dateFilter: req.query.dateFilter as any,
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate component usage report" });
  }
});

/**
 * GET /api/reports/lot-traceability - Lot Traceability Report
 */
router.get("/reports/lot-traceability", validateDateFilters, async (req, res) => {
  try {
    const filters: ReportFilters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      dateFilter: req.query.dateFilter as any,
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate lot traceability report" });
  }
});

/**
 * GET /api/reports/trend - Trend Report
 */
router.get("/reports/trend", validateDateFilters, async (req, res) => {
  try {
    const filters: ReportFilters = {
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      dateFilter: req.query.dateFilter as any,
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
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate trend report" });
  }
});

/**
 * POST /api/reports/export/:reportType - Export report to PDF/Excel/CSV
 * Auth: Requires qa or engineer role (BUG-04 fix)
 */
router.post("/reports/export/:reportType", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { reportType } = req.params;
    const { format = "pdf", filters, bomId, title } = req.body;

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
      "bom",
    ];

    if (!validReportTypes.includes(reportType as string)) {
      return res.status(400).json({ error: "Invalid report type" });
    }

    if (!["pdf", "xlsx", "csv"].includes(format)) {
      return res.status(400).json({ error: "Invalid export format. Use: pdf, xlsx, or csv" });
    }

    // Generate the report data based on type
    let reportData: any = [];
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
      case "bom": {
        // BOM export is keyed by bomId (not date filters). Pull the BOM's live
        // items and flatten to the columns the operator sees in the UI table.
        const parsedBomId = Number(bomId);
        if (!Number.isInteger(parsedBomId) || parsedBomId <= 0) {
          return res.status(400).json({ error: "bomId is required for BOM export" });
        }
        const items = await db
          .select()
          .from(bomItemsTable)
          .where(and(eq(bomItemsTable.bomId, parsedBomId), not(eq(bomItemsTable.isDeleted, true))));
        reportData = items.map((item) => ({
          Feeder: item.feederNumber ?? "—",
          "MPN/Part": item.mpn ?? item.partNumber ?? "—",
          Manufacturer: item.manufacturer ?? "—",
          Package: item.packageSize ?? item.package ?? "—",
          Qty: item.quantity ?? 1,
          Description: item.description ?? "—",
        }));
        break;
      }
    }

    const queryTime = Date.now() - startTime;

    // Export based on format
    let filePath: string;
    const exportOptions = {
      reportType: reportType as string,
      format: format as "pdf" | "xlsx" | "csv",
    };

    switch (format) {
      case "pdf":
        filePath = await ExportService.exportToPdf(reportData, exportOptions, req.actor?.id ?? "system");
        break;
      case "xlsx":
        filePath = await ExportService.exportToExcel(reportData, exportOptions, req.actor?.id ?? "system");
        break;
      case "csv":
        filePath = await ExportService.exportToCsv(reportData, exportOptions, req.actor?.id ?? "system");
        break;
      default:
        throw new Error("Invalid export format");
    }

    // Save report metadata to database
    const [reportRecord] = await db
      .insert(reportsTable)
      .values({
        reportType: reportType as string,
        sessionId: null,
        bomId: null,
        format,
        filePath,
        filters: filters ?? {},
        recordCount: Array.isArray(reportData) ? reportData.length : 0,
        queryTimeMs: queryTime,
        generatedBy: req.actor?.id ?? "system",
      })
      .returning({ id: reportsTable.id });

    // Module 15 — capture every server-generated report into the fixed server
    // archive directory, so all reports are stored server-side no matter which
    // browser/PC requested them. Deduped per export row; best-effort (never
    // blocks the download).
    if (reportRecord?.id) {
      await archiveExistingFile(reportType as string, String(reportRecord.id), filePath, String(format));
    }

    // Record export in audit table
    if (reportRecord?.id) {
      await ExportService.recordExport(
        reportRecord.id,
        req.actor?.id ?? "system",
        format as "pdf" | "xlsx" | "csv",
        req.ip,
        req.get("user-agent")
      );
    }

    // Module 9.2: consolidated audit trail entry for the report export.
    const actor = req.actor;
    if (actor?.id) {
      await db.insert(auditLogsTable).values({
        entityType: "report",
        entityId: reportRecord?.id ? String(reportRecord.id) : String(reportType),
        action: "report_exported",
        changedBy: actor.id,
        actorRole: actor.role,
        newValue: JSON.stringify({ reportType, format, recordCount: Array.isArray(reportData) ? reportData.length : 0 }),
        description: `Report "${reportType}" exported as ${String(format).toUpperCase()} by ${actor.name}`,
      });
    }

    // Stream the generated file back so the browser actually receives it.
    // (The file is also persisted on the server + recorded above for history.)
    // Metadata that used to be in the JSON body is surfaced as headers so the
    // client can still read it without a second request.
    const downloadName = `${title || reportType}-report.${format}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("X-Record-Count", String(Array.isArray(reportData) ? reportData.length : 0));
    res.setHeader("X-Query-Time-Ms", String(queryTime));
    return res.download(filePath, downloadName, (err) => {
      if (err && !res.headersSent) {
        req.log.error(err);
        res.status(500).json({ error: "Failed to send export file" });
      }
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to export report" });
  }
});

/**
 * GET /api/reports/exports/history - Get user's export history
 * Auth: Requires qa or engineer role (BUG-04 fix)
 */
router.get("/reports/exports/history", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const userId = req.actor?.id ?? "system";

    const exports = await db.select().from(reportExportsTable).where(eq(reportExportsTable.userId, userId));

    return res.json({
      exports: exports,
      count: exports.length,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get export history" });
  }
});

export default router;
