import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 7: manual daily inspection log (QF-OP-03). Idempotent bootstrap
// mirroring schema/daily_inspection_log.ts. Run once with tsx.
async function createDailyInspectionLogTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "daily_inspection_log" (
      "id" serial PRIMARY KEY NOT NULL,
      "entry_date" date NOT NULL,
      "part_number" text NOT NULL,
      "line_number" text,
      "shift" text,
      "total_qty_checked" integer DEFAULT 0 NOT NULL,
      "first_shot_qty" integer DEFAULT 0 NOT NULL,
      "ok_qty" integer DEFAULT 0 NOT NULL,
      "not_ok_qty" integer DEFAULT 0 NOT NULL,
      "entered_by" uuid REFERENCES "users"("id"),
      "entered_by_name" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "daily_inspection_log_entry_date_idx"
      ON "daily_inspection_log" ("entry_date");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "daily_inspection_log_part_number_idx"
      ON "daily_inspection_log" ("part_number");
  `);
}

createDailyInspectionLogTable()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
