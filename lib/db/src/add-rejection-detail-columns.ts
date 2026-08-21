import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 7.5: add nullable Defect Details columns to qa_inhouse_rejections so
// the original session-keyed logger keeps working while the changeover-
// autopopulate form fills the richer fields. Idempotent ADD COLUMN.
async function addRejectionDetailColumns() {
  await db.execute(sql`ALTER TABLE "qa_inhouse_rejections" ADD COLUMN IF NOT EXISTS "entry_date" date;`);
  await db.execute(sql`ALTER TABLE "qa_inhouse_rejections" ADD COLUMN IF NOT EXISTS "line_number" text;`);
  await db.execute(sql`ALTER TABLE "qa_inhouse_rejections" ADD COLUMN IF NOT EXISTS "bom_name" text;`);
  await db.execute(sql`ALTER TABLE "qa_inhouse_rejections" ADD COLUMN IF NOT EXISTS "part_number" text;`);
  await db.execute(sql`ALTER TABLE "qa_inhouse_rejections" ADD COLUMN IF NOT EXISTS "stage" text;`);
  await db.execute(sql`ALTER TABLE "qa_inhouse_rejections" ADD COLUMN IF NOT EXISTS "component" text;`);
  await db.execute(sql`ALTER TABLE "qa_inhouse_rejections" ADD COLUMN IF NOT EXISTS "location" text;`);
  await db.execute(sql`ALTER TABLE "qa_inhouse_rejections" ADD COLUMN IF NOT EXISTS "machine" text;`);
  await db.execute(sql`ALTER TABLE "qa_inhouse_rejections" ADD COLUMN IF NOT EXISTS "shift" text;`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "qa_inhouse_rejections_entry_date_idx"
      ON "qa_inhouse_rejections" ("entry_date");
  `);
}

addRejectionDetailColumns()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
