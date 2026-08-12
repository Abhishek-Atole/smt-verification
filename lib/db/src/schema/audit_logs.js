import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
export const auditLogsTable = pgTable("audit_logs", {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(), // 'feeder', 'component', 'alternate', 'bom_item', etc.
    entityId: text("entity_id").notNull(), // ID of the entity that was changed
    action: text("action").notNull(), // 'create', 'update', 'delete', 'approve', etc.
    oldValue: text("old_value"), // JSON string of old data
    newValue: text("new_value"), // JSON string of new data
    changedBy: text("changed_by"), // User/operator who made the change
    description: text("description"), // Human-readable description
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    entityTypeIdx: index("audit_logs_entity_type_idx").on(table.entityType),
    entityIdIdx: index("audit_logs_entity_id_idx").on(table.entityId),
    createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt),
}));
export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
    id: true,
}).extend({
    createdAt: z.date().optional(),
});
