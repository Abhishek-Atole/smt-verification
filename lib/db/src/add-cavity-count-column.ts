import { sql } from "drizzle-orm";
import { db } from "./index";

// Surgical migration for Module 5 (BOM cavity_count). `drizzle-kit push` needs
// an interactive TTY to resolve unrelated dev-DB drift; this adds ONLY the
// cavity_count column, idempotently. DEFAULT 1 backfills existing BOM rows so
// the NOT NULL constraint holds; new rows are validated (min 1) at the API layer.
// Structure mirrors schema/bom.ts exactly, so a later push sees no diff.
async function addCavityCountColumn() {
  await db.execute(sql`
    ALTER TABLE "boms"
      ADD COLUMN IF NOT EXISTS "cavity_count" integer DEFAULT 1 NOT NULL;
  `);
}

addCavityCountColumn()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
