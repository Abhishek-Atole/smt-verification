import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 3: production data captured at changeover closure. Idempotent, mirrors
// schema/sessions.ts. `drizzle-kit push` needs an interactive TTY on the drifted
// dev DB; this touches nothing else.
async function addClosureColumns() {
  await db.execute(sql`
    ALTER TABLE "sessions"
      ADD COLUMN IF NOT EXISTS "total_production_quantity" integer,
      ADD COLUMN IF NOT EXISTS "current_cycle_time" double precision,
      ADD COLUMN IF NOT EXISTS "total_output_units" integer;
  `);
}

addClosureColumns()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
