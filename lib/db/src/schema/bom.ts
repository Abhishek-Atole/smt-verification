import { pgTable, serial, text, integer, timestamp, index, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bomsTable = pgTable("boms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: text("created_by"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
  // Revision tracking
  revisionLabel: text("revision_label"), // e.g., 'Rev A', 'Rev B'
  parentBomId: integer("parent_bom_id"),
  revisionNotes: text("revision_notes"),
  isLatest: boolean("is_latest").default(true),
});

export const bomItemsTable = pgTable(
  "bom_items",
  {
    id: serial("id").primaryKey(),
    bomId: integer("bom_id")
      .notNull()
      .references(() => bomsTable.id, { onDelete: "cascade" }),
    // Core 12 fields
    srNo: text("sr_no"),
    feederNumber: text("feeder_number").notNull(),
    ucalIntPn: text("ucal_int_pn"),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    reference: text("reference"),
    description: text("description"),
    package: text("package"),
    make1: text("make_1"),
    mpn1: text("mpn_1"),
    make2: text("make_2"),
    mpn2: text("mpn_2"),
    make3: text("make_3"),
    mpn3: text("mpn_3"),
    remarks: text("remarks"),
    action: text("action"),
    // Legacy
    itemName: text("item_name"),
    rdeplyPartNo: text("rdeply_part_no"),
    referenceDesignator: text("reference_designator"),
    requiredQty: text("required_qty"),
    referenceLocation: text("reference_location"),
    internalPartNumber: text("internal_part_number"),
    values: text("values"),
    packageDescription: text("package_description"),
    dnpParts: boolean("dnp_parts").default(false),
    supplier1: text("supplier_1"),
    partNo1: text("part_no_1"),
    supplier2: text("supplier_2"),
    partNo2: text("part_no_2"),
    supplier3: text("supplier_3"),
    partNo3: text("part_no_3"),
    partNumber: text("part_number"),
    feederId: integer("feeder_id"),
    componentId: integer("component_id"),
    mpn: text("mpn"),
    manufacturer: text("manufacturer"),
    packageSize: text("package_size"),
    expectedMpn: text("expected_mpn"),
    location: text("location"),
    leadTime: integer("lead_time"),
    cost: numeric("cost", { precision: 10, scale: 4 }),
    isAlternate: boolean("is_alternate").default(false),
    parentItemId: integer("parent_item_id") as any,
    internalId: text("internal_id"),
    isDeleted: boolean("is_deleted").default(false),
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
  } as any,
  (table: any) => ({
    bomIdIdx: index("bom_items_bom_id_idx").on(table.bomId),
    parentItemIdx: index("bom_items_parent_item_id_idx").on(table.parentItemId),
    isDeletedIdx: index("bom_items_is_deleted_idx").on(table.isDeleted),
  })
) as any;

export const insertBomSchema = createInsertSchema(bomsTable).omit({ id: true }).extend({
  createdAt: z.date().optional(),
});
export const insertBomItemSchema = createInsertSchema(bomItemsTable).omit({ id: true });

export type Bom = typeof bomsTable.$inferSelect;
export type InsertBom = z.infer<typeof insertBomSchema>;
export type BomItem = typeof bomItemsTable.$inferSelect;
export type InsertBomItem = z.infer<typeof insertBomItemSchema>;
