import { sql } from "drizzle-orm";
import { db } from "./index";

// Surgical migration for Module 1 (changeover start: BOM skip + approval gate).
// Adds ONLY the new sessions columns, idempotently, mirroring schema/sessions.ts.
// A later drizzle-kit push then sees no diff for these columns.
async function addChangeoverSkipColumns() {
  await db.execute(sql`
    ALTER TABLE "sessions"
      ADD COLUMN IF NOT EXISTS "bom_verification_skipped" boolean DEFAULT false NOT NULL,
      ADD COLUMN IF NOT EXISTS "bom_skip_approver_role" text,
      ADD COLUMN IF NOT EXISTS "bom_skip_approver_name" text,
      ADD COLUMN IF NOT EXISTS "bom_skip_approval_at" timestamp,
      ADD COLUMN IF NOT EXISTS "bom_skip_approval_remarks" text;
  `);
}

addChangeoverSkipColumns()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
