import { pgTable, uuid, varchar, timestamp, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

// inet column type — drizzle-orm doesn't have a first-class inet; varchar(64) at the type level,
// the live column is INET (cast handled at the query layer when filtering by ip ranges).
export const refreshTokensTable = pgTable(
  "refresh_tokens",
  {
    id:          uuid("id").primaryKey().defaultRandom(),
    userId:      uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash:   varchar("token_hash", { length: 64 }).notNull().unique(),
    issuedAt:    timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt:   timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt:   timestamp("revoked_at", { withTimezone: true }),
    replacedBy:  uuid("replaced_by").references((): AnyPgColumn => refreshTokensTable.id, { onDelete: "set null" }),
    userAgent:   varchar("user_agent", { length: 255 }),
    ip:          varchar("ip", { length: 64 }), // live column is INET
    // U7 — session fingerprinting (PRD §11.7, BACKEND-SCHEMA §14.1)
    fingerprint: varchar("fingerprint", { length: 64 }),
    jti:         uuid("jti").notNull().default(sql`gen_random_uuid()`),
  },
  (t) => ({
    userIdIdx:    index("idx_rt_user_id").on(t.userId),
    expiresAtIdx: index("idx_rt_expires_at").on(t.expiresAt),
  })
);

export type RefreshToken       = typeof refreshTokensTable.$inferSelect;
export type InsertRefreshToken = typeof refreshTokensTable.$inferInsert;
