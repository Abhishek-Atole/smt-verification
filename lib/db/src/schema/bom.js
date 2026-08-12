import { pgTable, serial, text, integer, timestamp, index, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
export const bomsTable = pgTable("boms", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"), // Soft delete timestamp
    deletedBy: text("deleted_by"), // User who deleted
});
export const bomItemsTable = pgTable("bom_items", {
    id: serial("id").primaryKey(),
    bomId: integer("bom_id")
        .notNull()
        .references(() => bomsTable.id, { onDelete: "cascade" }),
    // CSV Fields - Required
    srNo: text("sr_no"),
    feederNumber: text("feeder_number").notNull(),
    itemName: text("item_name").notNull(),
    rdeplyPartNo: text("rdeply_part_no"),
    referenceDesignator: text("reference_designator"),
    // CSV Fields - Optional
    values: text("values"),
    packageDescription: text("package_description"),
    dnpParts: boolean("dnp_parts").default(false),
    supplier1: text("supplier_1"),
    partNo1: text("part_no_1"),
    supplier2: text("supplier_2"),
    partNo2: text("part_no_2"),
    supplier3: text("supplier_3"),
    partNo3: text("part_no_3"),
    remarks: text("remarks"),
    // Legacy Fields (for backward compatibility)
    partNumber: text("part_number").notNull(),
    feederId: integer("feeder_id"),
    componentId: integer("component_id"),
    mpn: text("mpn"),
    manufacturer: text("manufacturer"),
    packageSize: text("package_size"),
    expectedMpn: text("expected_mpn"),
    description: text("description"),
    location: text("location"),
    quantity: integer("quantity").notNull().default(1),
    leadTime: integer("lead_time"),
    cost: numeric("cost", { precision: 10, scale: 4 }),
    isAlternate: boolean("is_alternate").default(false),
    parentItemId: integer("parent_item_id"),
    internalId: text("internal_id"), // NEW: Internal ID for verification (optional)
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
}, (table) => ({
    bomIdIdx: index("bom_items_bom_id_idx").on(table.bomId),
    parentItemIdx: index("bom_items_parent_item_id_idx").on(table.parentItemId),
}));
export const insertBomSchema = createInsertSchema(bomsTable).omit({ id: true }).extend({
    createdAt: z.date().optional(),
});
export const insertBomItemSchema = createInsertSchema(bomItemsTable).omit({ id: true });
