import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 15 — report archival to a fixed filesystem path. Surgical, idempotent
// migration mirroring schema/admin.ts (reportArchiveRecordTable). Creates the
// report_archive_record table + a unique (report_type, related_entity_id) index
// so a session's canonical archive is recorded once. A later `drizzle-kit push`
// sees no diff.
async function addReportArchiveRecord() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "report_archive_record" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "report_type" text NOT NULL,
      "related_entity_id" text NOT NULL,
      "file_path" text NOT NULL,
      "file_size_bytes" bigint,
      "checksum" text,
      "generated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "report_archive_type_entity_idx"
      ON "report_archive_record" ("report_type", "related_entity_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "report_archive_type_idx"
      ON "report_archive_record" ("report_type");
  `);
}

addReportArchiveRecord()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
