import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Module 7: configurable document-control strip for the QA report header
// (Document No / Rev No / Rev Date / Page No). Keyed by doc_key (e.g. QF-OP-03)
// so the values are edited at runtime instead of hardcoded in the page.
export const documentControlTable = pgTable("document_control", {
  docKey: text("doc_key").primaryKey(),
  documentNo: text("document_no"),
  revNo: text("rev_no"),
  revDate: text("rev_date"),
  pageNo: text("page_no"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDocumentControlSchema = createInsertSchema(documentControlTable);

export type DocumentControl = typeof documentControlTable.$inferSelect;
export type InsertDocumentControl = z.infer<typeof insertDocumentControlSchema>;
