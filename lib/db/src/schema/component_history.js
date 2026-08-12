import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
export const componentHistoryTable = pgTable("component_history", {
    id: serial("id").primaryKey(),
    scanRecordId: integer("scan_record_id"), // Optional reference to scan record
    reelId: text("reel_id"), // Physical reel identifier
    mpn: text("mpn").notNull(), // What was scanned
    lotNumber: text("lot_number"), // Component lot
    dateCode: text("date_code"), // Manufacturing date code
    quantity: integer("quantity"), // Qty on reel
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (table) => ({
    reelIdIdx: index("component_history_reel_id_idx").on(table.reelId),
    lotNumberIdx: index("component_history_lot_number_idx").on(table.lotNumber),
    mpnIdx: index("component_history_mpn_idx").on(table.mpn),
}));
export const insertComponentHistorySchema = createInsertSchema(componentHistoryTable).omit({
    id: true,
}).extend({
    recordedAt: z.date().optional(),
});
