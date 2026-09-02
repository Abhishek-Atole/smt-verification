import { pgTable, serial, integer, text, date, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Module 11.4 — Reel/Lot Master. One row per physical reel received at store,
// plus 11.7's issue-to-line event on the same row (status + current_line_name +
// issued_* fields). Traceability only: bin/batch/lot/dc differing between two
// reels of the SAME part is expected and is never a component mismatch, so
// nothing here is unique-constrained and nothing here gates a scan.
//
// partNumber is text, not an FK to components: the live Component Master holds
// 5 rows while BOMs carry 46 items with only 3 component_id links, and every
// existing match in this system (verifyMPN) is text-on-text.
// currentLineName is text for the same reason — lines are text on sessions and
// a roster of approvers rows with category 'line'; there is no lines table.
export const reelsTable = pgTable(
  "reels",
  {
    id: serial("id").primaryKey(),
    partNumber: text("part_number").notNull(), // stored uppercase-normalized
    description: text("description"),
    binNo: text("bin_no"), // luminosity/color bin, NOT a different part
    batchNo: text("batch_no"),
    lotNo: text("lot_no"),
    dcCode: text("dc_code"), // date code, e.g. 2618
    mfgDate: date("mfg_date"),
    expDate: date("exp_date"),
    qtyReceived: integer("qty_received"),
    receivedDate: date("received_date"),
    // in_stock | issued | in_use | consumed | expired — text (validated in the
    // route) to match sessions.status / component_alternates.approval_status
    // rather than adding another pg enum.
    status: text("status").notNull().default("in_stock"),
    currentLineName: text("current_line_name"),
    receivedBy: uuid("received_by").references(() => usersTable.id),
    receivedByName: text("received_by_name"),
    issuedAt: timestamp("issued_at"),
    issuedBy: uuid("issued_by").references(() => usersTable.id),
    issuedByName: text("issued_by_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    partNumberIdx: index("reels_part_number_idx").on(table.partNumber),
    statusIdx: index("reels_status_idx").on(table.status),
    lotNoIdx: index("reels_lot_no_idx").on(table.lotNo),
    currentLineNameIdx: index("reels_current_line_name_idx").on(table.currentLineName),
  })
);

export const insertReelSchema = createInsertSchema(reelsTable).omit({
  id: true,
  createdAt: true,
});

export type Reel = typeof reelsTable.$inferSelect;
export type InsertReel = z.infer<typeof insertReelSchema>;
