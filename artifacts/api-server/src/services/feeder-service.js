// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@workspace/db";
import { feedersTable, } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
export class FeederService {
    /**
     * Get all feeders with optional filtering
     */
    static async getFeeders(filter) {
        // @ts-ignore - Drizzle query builder type inference issue
        let query = db.select().from(feedersTable);
        if (filter?.status) {
            query = query.where(eq(feedersTable.status, filter.status));
        }
        const result = await query;
        return result;
    }
    /**
     * Get feeder by ID (database ID)
     */
    static async getFeederById(id) {
        const result = await db
            .select()
            .from(feedersTable)
            .where(eq(feedersTable.id, id));
        return result[0] || null;
    }
    /**
     * Get feeder by Feeder ID (business ID like "FDR_001") - CRITICAL for scan validation
     */
    static async getFeederByFeederId(feederId) {
        const result = await db
            .select()
            .from(feedersTable)
            .where(eq(feedersTable.feederId, feederId));
        return result[0] || null;
    }
    /**
     * Create new feeder
     */
    static async createFeeder(data) {
        // @ts-ignore - Drizzle insert type inference issue
        const result = (await db
            .insert(feedersTable)
            .values(data)
            .returning());
        return result[0];
    }
    /**
     * Update feeder
     */
    static async updateFeeder(id, data) {
        const result = await db
            .update(feedersTable)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(feedersTable.id, id))
            .returning();
        return result[0] || null;
    }
    /**
     * Delete/deactivate feeder
     */
    static async deleteFeeder(id) {
        const result = await db
            .update(feedersTable)
            .set({ status: "inactive", updatedAt: new Date() })
            .where(eq(feedersTable.id, id));
        return (result.rowCount ?? 0) > 0;
    }
    /**
     * Validate feeder exists and is active
     */
    static async validateFeederExists(feederId) {
        const feeder = await this.getFeederByFeederId(feederId);
        return feeder !== null && feeder.status === "active";
    }
    /**
     * Get feeder details including component mappings from BOM
     */
    static async getFeederWithBomContext(feederId, bomId) {
        const feeder = await this.getFeederByFeederId(feederId);
        if (!feeder)
            return null;
        // Would join with BOM items to get component context
        // For now, return the feeder
        return feeder;
    }
}
