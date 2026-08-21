import { Router, type IRouter } from "express";
import { AuditService } from "../services/audit-service";
import { attachActor, requireRole, type AuthRequest } from "../middleware/auth";
import { db } from "@workspace/db";
import {
  auditLogsTable,
  sessionsTable,
  dailyInspectionLogTable,
  qaInhouseRejectionsTable,
  bypassLogTable,
} from "@workspace/db/schema";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

const router: IRouter = Router();

router.use(attachActor);

/**
 * POST /api/audit/log - Record an audit log entry
 */
router.post("/audit/log", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { entityType, entityId, action, oldValue, newValue, changedBy, description } = req.body;

    if (!entityType || !entityId || !action || !changedBy) {
      return res.status(400).json({
        error: "Missing required fields: entityType, entityId, action, changedBy",
      });
    }

    const log = await AuditService.recordAuditLog({
      entityType,
      entityId,
      action,
      oldValue: oldValue ? JSON.stringify(oldValue) : null,
      newValue: newValue ? JSON.stringify(newValue) : null,
      changedBy,
      description,
    });

    return res.json({ success: true, log });
  } catch (error) {
    return res.status(500).json({ error: `Failed to record audit log: ${error}` });
  }
});

/**
 * GET /api/audit/logs/:entityType/:entityId - Get audit logs for an entity
 */
router.get("/audit/logs/:entityType/:entityId", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { entityType, entityId } = req.params;
    const logs = await AuditService.getAuditLogsForEntity(entityType as string, entityId as string);

    return res.json({
      entityType,
      entityId,
      count: logs.length,
      logs,
    });
  } catch (error) {
    return res.status(500).json({ error: `Failed to get audit logs: ${error}` });
  }
});

/**
 * GET /api/audit/logs/action/:action - Get audit logs by action
 */
router.get("/audit/logs/action/:action", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { action } = req.params;
    const logs = await AuditService.getAuditLogsByAction(action as string);

    return res.json({
      action,
      count: logs.length,
      logs,
    });
  } catch (error) {
    return res.status(500).json({ error: `Failed to get audit logs by action: ${error}` });
  }
});

/**
 * GET /api/audit/logs/user/:userId - Get audit logs by user
 */
router.get("/audit/logs/user/:userId", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;
    const logs = await AuditService.getAuditLogsByUser(userId as string);

    return res.json({
      userId,
      count: logs.length,
      logs,
    });
  } catch (error) {
    return res.status(500).json({ error: `Failed to get audit logs by user: ${error}` });
  }
});

/**
 * Module 9: GET /api/audit/recent - Recent audit log entries with optional
 * entityType / action filters. Backs the admin audit log table.
 */
router.get("/audit/recent", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const entityType = req.query.entityType ? String(req.query.entityType) : null;
    const action = req.query.action ? String(req.query.action) : null;

    const filters = [
      entityType ? eq(auditLogsTable.entityType, entityType) : undefined,
      action ? eq(auditLogsTable.action, action) : undefined,
    ].filter(Boolean);

    const logs = await db
      .select()
      .from(auditLogsTable)
      .where(filters.length > 0 ? and(...(filters as any[])) : sql`true`)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);

    return res.json({ count: logs.length, logs });
  } catch (error) {
    return res.status(500).json({ error: `Failed to get recent audit logs: ${error}` });
  }
});

/**
 * Module 9: GET /api/audit/monitoring - System monitoring summary for the admin
 * dashboard: session states, today's activity, and event counts by action.
 */
router.get("/audit/monitoring", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [sessions, logsToday, byAction] = await Promise.all([
      db
        .select({ status: sessionsTable.status })
        .from(sessionsTable)
        .where(sql`${sessionsTable.deletedAt} IS NULL`),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(auditLogsTable)
        .where(gte(auditLogsTable.createdAt, startOfDay)),
      db
        .select({ action: auditLogsTable.action, count: sql<number>`COUNT(*)::int` })
        .from(auditLogsTable)
        .where(gte(auditLogsTable.createdAt, startOfDay))
        .groupBy(auditLogsTable.action)
        .orderBy(desc(sql`COUNT(*)`)),
    ]);

    const activeSessions = sessions.filter((s) => s.status === "active").length;
    const completedSessions = sessions.filter((s) => s.status === "completed").length;

    return res.json({
      totalSessions: sessions.length,
      activeSessions,
      completedSessions,
      eventsToday: Number(logsToday[0]?.count ?? 0),
      byAction,
    });
  } catch (error) {
    return res.status(500).json({ error: `Failed to get monitoring data: ${error}` });
  }
});

// Module 9.1: GET /api/monitoring/summary - consolidated admin monitoring
// dashboard. Per Decision #4 each source is queried independently: changeover
// status counts (sessions), rejection totals + PPM (daily_inspection_log +
// qa_inhouse_rejections), bypass totals (bypass_log), and recent handover
// audit rows (audit_logs).
router.get("/monitoring/summary", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const [statusRows, insp, rejectRow, bypassRow, handovers] = await Promise.all([
      db
        .select({ status: sessionsTable.status, count: sql<number>`COUNT(*)::int` })
        .from(sessionsTable)
        .where(sql`${sessionsTable.deletedAt} IS NULL`)
        .groupBy(sessionsTable.status),
      db
        .select({
          totalQtyChecked: sql<number>`COALESCE(SUM(${dailyInspectionLogTable.totalQtyChecked}), 0)::int`,
          notOkQty: sql<number>`COALESCE(SUM(${dailyInspectionLogTable.notOkQty}), 0)::int`,
        })
        .from(dailyInspectionLogTable),
      db
        .select({ totalRejected: sql<number>`COALESCE(SUM(${qaInhouseRejectionsTable.quantity}), 0)::int` })
        .from(qaInhouseRejectionsTable),
      db
        .select({
          aoi: sql<number>`COALESCE(SUM(CASE WHEN ${bypassLogTable.stage} = 'AOI' THEN ${bypassLogTable.quantity} ELSE 0 END), 0)::int`,
          spi: sql<number>`COALESCE(SUM(CASE WHEN ${bypassLogTable.stage} = 'SPI' THEN ${bypassLogTable.quantity} ELSE 0 END), 0)::int`,
          total: sql<number>`COALESCE(SUM(${bypassLogTable.quantity}), 0)::int`,
        })
        .from(bypassLogTable),
      db
        .select()
        .from(auditLogsTable)
        .where(inArray(auditLogsTable.action, ["handover_added", "changeover_created", "changeover_closed", "bom_skip_approved"]))
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(20),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const r of statusRows) statusCounts[r.status ?? "unknown"] = Number(r.count);

    const totalQtyChecked = Number(insp[0]?.totalQtyChecked ?? 0);
    const notOkQty = Number(insp[0]?.notOkQty ?? 0);
    const ppm = totalQtyChecked > 0 ? Math.round((notOkQty / totalQtyChecked) * 1_000_000) : 0;

    return res.json({
      changeover: { byStatus: statusCounts },
      rejection: {
        totalRejected: Number(rejectRow[0]?.totalRejected ?? 0),
        totalQtyChecked,
        notOkQty,
        ppm,
      },
      bypass: {
        aoi: Number(bypassRow[0]?.aoi ?? 0),
        spi: Number(bypassRow[0]?.spi ?? 0),
        total: Number(bypassRow[0]?.total ?? 0),
      },
      recentEvents: handovers,
    });
  } catch (error) {
    return res.status(500).json({ error: `Failed to get monitoring summary: ${error}` });
  }
});

export default router;