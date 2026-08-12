import { db } from "@workspace/db";
import {
  componentsTable,
  componentAlternatesTable,
  type Component,
  type InsertComponent,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

export class ComponentService {
  /**
   * Get all components
   */
  static async getComponents(): Promise<Component[]> {
    const result = await db.select().from(componentsTable);
    return result;
  }

  /**
   * Get component by database ID
   */
  static async getComponentById(id: number): Promise<Component | null> {
    const result = await db
      .select()
      .from(componentsTable)
      .where(eq(componentsTable.id, id));
    return result[0] || null;
  }

  /**
   * Get component by Part ID (e.g., "DIO_5V1_001") - CRITICAL for validation
   */
  static async getComponentByPartId(partId: string): Promise<Component | null> {
    const result = await db
      .select()
      .from(componentsTable)
      .where(eq(componentsTable.partId, partId));
    return result[0] || null;
  }

  /**
   * Get component by MPN (e.g., "MM1Z5V1") - CRITICAL for scan validation
   */
  static async getComponentByMpn(mpn: string): Promise<Component | null> {
    const result = await db
      .select()
      .from(componentsTable)
      .where(eq(componentsTable.mpn, mpn));
    return result[0] || null;
  }

  /**
   * Create new component
   */
  static async createComponent(data: InsertComponent): Promise<Component> {
    const result = await db
      .insert(componentsTable)
      .values(data)
      .returning();
    if (!result[0]) throw new Error("Failed to create component");
    return result[0];
  }

  /**
   * Update component
   */
  static async updateComponent(
    id: number,
    data: Partial<InsertComponent>
  ): Promise<Component | null> {
    const result = await db
      .update(componentsTable)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(componentsTable.id, id))
      .returning();
    return result[0] || null;
  }

  /**
   * Get all approved alternate components for a given primary component
   */
  static async getApprovedAlternates(primaryComponentId: number): Promise<
    Array<{
      alternate: Component;
      approvalStatus: string;
      approvedBy: string | null;
      notes: string | null;
    }>
  > {
    const result = await db
      .select({
        alternate: componentsTable,
        approvalStatus: componentAlternatesTable.approvalStatus,
        approvedBy: componentAlternatesTable.approvedBy,
        notes: componentAlternatesTable.notes,
      })
      .from(componentAlternatesTable)
      .innerJoin(
        componentsTable,
        eq(componentAlternatesTable.alternateComponentId, componentsTable.id)
      )
      .where(
        eq(componentAlternatesTable.primaryComponentId, primaryComponentId)
      );

    return result;
  }

  /**
   * Get list of approved alternate MPNs for a given component MPN
   */
  static async getApprovedAlternateMpns(mpn: string): Promise<string[]> {
    const component = await this.getComponentByMpn(mpn);
    if (!component) return [];

    const alternates = await this.getApprovedAlternates(component.id);
    return alternates
      .filter((alt) => alt.approvalStatus === "approved")
      .map((alt) => alt.alternate.mpn);
  }

  /**
   * Check if an alternate component is approved
   */
  static async isAlternateApproved(
    primaryComponentId: number,
    alternateComponentId: number
  ): Promise<boolean> {
    const result = await db
      .select()
      .from(componentAlternatesTable)
      .where(
        and(
          eq(componentAlternatesTable.primaryComponentId, primaryComponentId),
          eq(componentAlternatesTable.alternateComponentId, alternateComponentId),
          eq(componentAlternatesTable.approvalStatus, "approved")
        )
      );

    return result.length > 0;
  }

  /**
   * Add alternate component mapping
   */
  static async addAlternate(
    primaryComponentId: number,
    alternateComponentId: number,
    approvedBy?: string,
    notes?: string
  ) {
    const result = await db
      .insert(componentAlternatesTable)
      .values({
        primaryComponentId,
        alternateComponentId,
        approvalStatus: "approved",
        approvedBy,
        approvalDate: new Date(),
        notes,
      })
      .returning();
    return result[0];
  }

  /**
   * Approve pending alternate
   */
  static async approveAlternate(
    primaryComponentId: number,
    alternateComponentId: number,
    approvedBy: string,
    notes?: string
  ) {
    const result = await db
      .update(componentAlternatesTable)
      .set({
        approvalStatus: "approved",
        approvedBy,
        approvalDate: new Date(),
        notes,
      })
      .where(
        and(
          eq(componentAlternatesTable.primaryComponentId, primaryComponentId),
          eq(componentAlternatesTable.alternateComponentId, alternateComponentId)
        )
      )
      .returning();
    if (!result[0]) throw new Error("Failed to approve alternate");
    return result[0];
  }
}
