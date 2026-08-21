import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 7: QA in-house rejections table. Idempotent bootstrap mirroring
// schema/qa_rejections.ts (drizzle-kit push needs an interactive TTY on the
// drifted dev DB; this touches nothing else). Run once with tsx.
async function createQaInhouseRejectionsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "qa_inhouse_rejections" (
      "id" serial PRIMARY KEY NOT NULL,
      "session_id" integer NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
      "defect_type" text NOT NULL,
      "quantity" integer NOT NULL,
      "remarks" text,
      "recorded_by" uuid REFERENCES "users"("id"),
      "recorded_by_name" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "qa_inhouse_rejections_session_id_idx"
      ON "qa_inhouse_rejections" ("session_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "qa_inhouse_rejections_defect_type_idx"
      ON "qa_inhouse_rejections" ("defect_type");
  `);
}

createQaInhouseRejectionsTable()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
