import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().default(""),
    role: text("role").notNull().default("operator"),
    employee_id: text("employee_id"),
    password_hash: text("password_hash"),
    user_type: text("user_type").notNull().default("operator"),
    is_active: boolean("is_active").default(true).notNull(),
    must_change_password: boolean("must_change_password").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    roleIdx: index("users_role_idx").on(table.role),
  })
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
