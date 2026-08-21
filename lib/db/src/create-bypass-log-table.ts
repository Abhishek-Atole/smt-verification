import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 8: manual per-stage bypass log (AOI / SPI). Idempotent bootstrap
// mirroring schema/bypass_log.ts. Run once with tsx.
async function createBypassLogTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "bypass_log" (
      "id" serial PRIMARY KEY NOT NULL,
      "entry_date" date NOT NULL,
      "shift" text,
      "line_number" text,
      "stage" text NOT NULL,
      "quantity" integer NOT NULL,
      "entered_by" uuid REFERENCES "users"("id"),
      "entered_by_name" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "bypass_log_entry_date_idx"
      ON "bypass_log" ("entry_date");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "bypass_log_line_number_idx"
      ON "bypass_log" ("line_number");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "bypass_log_stage_idx"
      ON "bypass_log" ("stage");
  `);
}

createBypassLogTable()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
