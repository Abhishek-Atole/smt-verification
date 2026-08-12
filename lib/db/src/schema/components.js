import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const componentsTable = pgTable("components", {
    id: serial("id").primaryKey(),
    partId: text("part_id").notNull().unique(), // e.g., "DIO_5V1_001"
    mpn: text("mpn").notNull().unique(), // e.g., "MM1Z5V1"
    description: text("description"),
    manufacturer: text("manufacturer"),
    category: text("category"), // 'resistor', 'capacitor', 'diode', etc.
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    mpnIdx: index("component_mpn_idx").on(table.mpn),
    partIdIdx: index("component_part_id_idx").on(table.partId),
}));
export const insertComponentSchema = createInsertSchema(componentsTable).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
