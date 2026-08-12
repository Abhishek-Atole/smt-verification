import { Router, type IRouter } from "express";
import { AuditService } from "../services/audit-service";
import { attachActor, requireRole, type AuthRequest } from "../middleware/auth";

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

export default router;
