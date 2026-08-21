import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 7: configurable document-control header (QF-OP-03). Idempotent
// bootstrap mirroring schema/document_control.ts; seeds one default row.
async function createDocumentControlTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "document_control" (
      "doc_key" text PRIMARY KEY NOT NULL,
      "document_no" text,
      "rev_no" text,
      "rev_date" text,
      "page_no" text,
      "updated_by" uuid,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    INSERT INTO "document_control" ("doc_key", "document_no", "rev_no", "rev_date", "page_no")
    VALUES ('QF-OP-03', 'QF-OP-03', '00', '', '1 of 1')
    ON CONFLICT ("doc_key") DO NOTHING;
  `);
}

createDocumentControlTable()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
