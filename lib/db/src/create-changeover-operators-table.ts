import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 2.2/4.3: co-ownership join table for the legacy sessionsTable. Created
// idempotently, mirroring schema/sessions.ts (changeoverOperatorsTable) exactly,
// so a later drizzle-kit push sees no diff. `drizzle-kit push` needs an
// interactive TTY on the drifted dev DB; this touches nothing else.
async function createChangeoverOperatorsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "changeover_operators" (
      "id" serial PRIMARY KEY NOT NULL,
      "session_id" integer NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
      "operator_id" uuid NOT NULL REFERENCES "users"("id"),
      "role" text DEFAULT 'creator' NOT NULL,
      "added_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "changeover_operators_session_id_idx"
      ON "changeover_operators" ("session_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "changeover_operators_operator_id_idx"
      ON "changeover_operators" ("operator_id");
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "changeover_operators_session_operator_uq"
      ON "changeover_operators" ("session_id", "operator_id");
  `);
  // Module 4 (2026-08-30): pending-handover columns. Idempotent so re-running is
  // safe and a later drizzle-kit push sees no diff. Existing rows default to
  // 'accepted' — they keep the access they already had.
  await db.execute(sql`
    ALTER TABLE "changeover_operators"
      ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'accepted' NOT NULL,
      ADD COLUMN IF NOT EXISTS "from_operator_id" uuid REFERENCES "users"("id"),
      ADD COLUMN IF NOT EXISTS "notes" text,
      ADD COLUMN IF NOT EXISTS "accepted_at" timestamp;
  `);
}

createChangeoverOperatorsTable()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
