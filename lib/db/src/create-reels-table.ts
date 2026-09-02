import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 11.4/11.7: Reel/Lot Master table. Idempotent bootstrap mirroring
// schema/reels.ts (drizzle-kit push reconciles the WHOLE schema and this DB has
// known drift elsewhere, so it must not be used here). Run once with tsx.
async function createReelsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "reels" (
      "id" serial PRIMARY KEY NOT NULL,
      "part_number" text NOT NULL,
      "description" text,
      "bin_no" text,
      "batch_no" text,
      "lot_no" text,
      "dc_code" text,
      "mfg_date" date,
      "exp_date" date,
      "qty_received" integer,
      "received_date" date,
      "status" text DEFAULT 'in_stock' NOT NULL,
      "current_line_name" text,
      "received_by" uuid REFERENCES "users"("id"),
      "received_by_name" text,
      "issued_at" timestamp,
      "issued_by" uuid REFERENCES "users"("id"),
      "issued_by_name" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "reels_part_number_idx" ON "reels" ("part_number");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "reels_status_idx" ON "reels" ("status");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "reels_lot_no_idx" ON "reels" ("lot_no");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "reels_current_line_name_idx" ON "reels" ("current_line_name");`);
}

createReelsTable()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
