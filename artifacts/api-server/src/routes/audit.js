// @ts-nocheck
import { Router } from "express";
import { AuditService } from "../services/audit-service";
const router = Router();
/**
 * POST /api/audit/log - Record an audit log entry
 */
router.post("/audit/log", async (req, res) => {
    try {
        const { entityType, entityId, action, oldValue, newValue, changedBy, description } = req.body;
        if (!entityType || !entityId || !action || !changedBy) {
            return res.status(400).json({
                error: "Missing required fields: entityType, entityId, action, changedBy",
            });
        }
        // @ts-ignore - Drizzle type inference issue with returning()
        // @ts-ignore - Drizzle type inference issue
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
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to record audit log: ${error}` });
    }
});
/**
 * GET /api/audit/logs/:entityType/:entityId - Get audit logs for an entity
 */
router.get("/audit/logs/:entityType/:entityId", async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const logs = await AuditService.getAuditLogsForEntity(entityType, entityId);
        return res.json({
            entityType,
            entityId,
            count: logs.length,
            logs,
        });
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to get audit logs: ${error}` });
    }
});
/**
 * GET /api/audit/logs/action/:action - Get audit logs by action
 */
router.get("/audit/logs/action/:action", async (req, res) => {
    try {
        const { action } = req.params;
        const logs = await AuditService.getAuditLogsByAction(action);
        return res.json({
            action,
            count: logs.length,
            logs,
        });
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to get audit logs by action: ${error}` });
    }
});
/**
 * GET /api/audit/logs/user/:userId - Get audit logs by user
 */
router.get("/audit/logs/user/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const logs = await AuditService.getAuditLogsByUser(userId);
        return res.json({
            userId,
            count: logs.length,
            logs,
        });
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to get audit logs by user: ${error}` });
    }
});
export default router;
