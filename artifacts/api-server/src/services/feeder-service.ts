import { db } from "@workspace/db";
import {
  feedersTable,
  type Feeder,
  type InsertFeeder,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export class FeederService {
  /**
   * Get all feeders with optional filtering
   */
  static async getFeeders(filter?: { status?: string }): Promise<Feeder[]> {
    if (filter?.status) {
      return await db.select().from(feedersTable).where(eq(feedersTable.status, filter.status));
    }

    return await db.select().from(feedersTable);
  }

  /**
   * Get feeder by ID (database ID)
   */
  static async getFeederById(id: number): Promise<Feeder | null> {
    const result = await db
      .select()
      .from(feedersTable)
      .where(eq(feedersTable.id, id));
    return result[0] || null;
  }

  /**
   * Get feeder by Feeder ID (business ID like "FDR_001") - CRITICAL for scan validation
   */
  static async getFeederByFeederId(feederId: string): Promise<Feeder | null> {
    const result = await db
      .select()
      .from(feedersTable)
      .where(eq(feedersTable.feederId, feederId));
    return result[0] || null;
  }

  /**
   * Create new feeder
   */
  static async createFeeder(data: InsertFeeder): Promise<Feeder> {
    const result = await db
      .insert(feedersTable)
      .values(data)
      .returning();
    if (!result[0]) throw new Error("Failed to create feeder");
    return result[0];
  }

  /**
   * Update feeder
   */
  static async updateFeeder(
    id: number,
    data: Partial<InsertFeeder>
  ): Promise<Feeder | null> {
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
  static async deleteFeeder(id: number): Promise<boolean> {
    const result = await db
      .update(feedersTable)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(eq(feedersTable.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Validate feeder exists and is active
   */
  static async validateFeederExists(feederId: string): Promise<boolean> {
    const feeder = await this.getFeederByFeederId(feederId);
    return feeder !== null && feeder.status === "active";
  }

  /**
   * Get feeder details including component mappings from BOM
   */
  static async getFeederWithBomContext(feederId: string, bomId: number) {
    const feeder = await this.getFeederByFeederId(feederId);
    if (!feeder) return null;

    // Would join with BOM items to get component context
    // For now, return the feeder
    return feeder;
  }
}
