import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const programsTable = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programName: text("program_name").notNull(),
    stage: text("stage").notNull(),
    version: text("version").notNull().default("1.0"),
    machineId: text("machine_id"),
    status: text("status").notNull().default("active"),
    qrPayload: text("qr_payload"),
    qrHash: text("qr_hash"),
    currentVersionId: uuid("current_version_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id),
    updatedBy: uuid("updated_by").references(() => usersTable.id),
    deletedAt: timestamp("deleted_at"),
    deletedBy: uuid("deleted_by").references(() => usersTable.id),
  },
  (table) => ({
    programNameIdx: index("programs_program_name_idx").on(table.programName),
    stageIdx: index("programs_stage_idx").on(table.stage),
    statusIdx: index("programs_status_idx").on(table.status),
    qrHashIdx: index("programs_qr_hash_idx").on(table.qrHash),
  })
);

export const insertProgramSchema = createInsertSchema(programsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Program = typeof programsTable.$inferSelect;
export type InsertProgram = z.infer<typeof insertProgramSchema>;
