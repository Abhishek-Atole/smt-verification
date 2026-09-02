import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 15b: report_output_settings. Idempotent bootstrap mirroring
// schema/report_output.ts (drizzle-kit push reconciles the WHOLE schema and this
// DB has known drift elsewhere, so it must not be used here). Run once with tsx.
//
// Seeds the single row so GET never returns null on a fresh install. The seed
// picks up REPORT_ARCHIVE_ROOT if it happens to be set in the environment, so an
// existing env-configured archive keeps working after the DB takes over.
async function createReportOutputSettingsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "report_output_settings" (
      "id" boolean PRIMARY KEY DEFAULT true NOT NULL,
      "client_folder_enabled" boolean DEFAULT false NOT NULL,
      "folder_label" text,
      "organize_subfolders" boolean DEFAULT true NOT NULL,
      "archive_enabled" boolean DEFAULT false NOT NULL,
      "archive_root" text,
      "updated_by" text,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "report_output_settings_single_row" CHECK ("id" = true)
    );
  `);

  const envRoot = process.env.REPORT_ARCHIVE_ROOT?.trim() || null;
  await db.execute(sql`
    INSERT INTO "report_output_settings" ("id", "archive_root", "archive_enabled")
    VALUES (true, ${envRoot}, ${envRoot !== null})
    ON CONFLICT ("id") DO NOTHING;
  `);
}

createReportOutputSettingsTable()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
