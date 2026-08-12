import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const feedersTable = pgTable("feeders", {
    id: serial("id").primaryKey(),
    feederId: text("feeder_id").notNull().unique(),
    feederType: text("feeder_type").notNull(), // 'SMT', 'Manual', etc.
    size: text("size").notNull(), // '8mm', '12mm', '16mm', etc.
    make: text("make").notNull(), // 'Yamaha', 'Fuji', etc.
    description: text("description"),
    status: text("status").notNull().default("active"), // 'active', 'inactive', 'maintenance'
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    feederIdIdx: index("feeder_id_idx").on(table.feederId),
}));
export const insertFeederSchema = createInsertSchema(feedersTable).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
