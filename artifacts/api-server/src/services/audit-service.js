// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { TimestampService } from "./timestamp-service";
export class AuditService {
    /**
     * Record an audit log entry
     */
    static async recordAuditLog(data) {
        // Ensure we use server timestamp for audit logs
        const auditData = {
            ...data,
            createdAt: data.createdAt || TimestampService.createAuditTimestamp(),
        };
        // @ts-ignore - Drizzle insert type inference issue
        const result = (await db
            .insert(auditLogsTable)
            .values(auditData)
            .returning());
        return result[0];
    }
    /**
     * Get audit logs for a specific entity
     */
    static async getAuditLogsForEntity(entityType, entityId) {
        // @ts-ignore - Drizzle select type inference issue
        const logs = await db
            .select()
            .from(auditLogsTable)
            .where(and(eq(auditLogsTable.entityType, entityType), eq(auditLogsTable.entityId, entityId)))
            .orderBy(auditLogsTable.createdAt);
        return logs;
    }
    /**
     * Get audit logs for a specific action type
     */
    static async getAuditLogsByAction(action, limit = 100) {
        // @ts-ignore - Drizzle select type inference issue
        const logs = await db
            .select()
            .from(auditLogsTable)
            .where(eq(auditLogsTable.action, action))
            .limit(limit)
            .orderBy(auditLogsTable.createdAt);
        return logs;
    }
    /**
     * Get audit logs by user
     */
    static async getAuditLogsByUser(userId, limit = 100) {
        // @ts-ignore - Drizzle select type inference issue  
        const logs = await db
            .select()
            .from(auditLogsTable)
            .where(eq(auditLogsTable.changedBy, userId))
            .limit(limit)
            .orderBy(auditLogsTable.createdAt);
        return logs;
    }
    /**
     * Get audit logs within a date range
     */
    static async getAuditLogsByDateRange(startDate, endDate, limit = 1000) {
        // @ts-ignore - Drizzle select type inference issue
        const logs = await db
            .select()
            .from(auditLogsTable)
            .where(and(gte(auditLogsTable.createdAt, startDate), lte(auditLogsTable.createdAt, endDate)))
            .limit(limit)
            .orderBy(auditLogsTable.createdAt);
        return logs;
    }
    /**
     * Get change history for an entity
     */
    static async getChangeHistory(entityType, entityId) {
        // @ts-ignore - Drizzle select type inference issue
        const logs = await db
            .select()
            .from(auditLogsTable)
            .where(and(eq(auditLogsTable.entityType, entityType), eq(auditLogsTable.entityId, entityId)))
            .orderBy(auditLogsTable.createdAt);
        const history = logs.map((log) => ({
            timestamp: log.createdAt,
            action: log.action,
            oldValue: log.oldValue ? JSON.parse(log.oldValue) : null,
            newValue: log.newValue ? JSON.parse(log.newValue) : null,
            changedBy: log.changedBy,
            description: log.description,
        }));
        return history;
    }
    /**
     * Get all entity changes with before/after comparison
     */
    static async getEntityDiff(entityType, entityId) {
        const logs = await this.getAuditLogsForEntity(entityType, entityId);
        return logs.map((log) => ({
            action: log.action,
            timestamp: log.createdAt,
            before: log.oldValue ? JSON.parse(log.oldValue) : null,
            after: log.newValue ? JSON.parse(log.newValue) : null,
            changedBy: log.changedBy,
        }));
    }
}
