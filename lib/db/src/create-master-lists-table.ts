import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 7: QA master lists (defect types, machines). Idempotent bootstrap
// mirroring schema/master_lists.ts. Run once with tsx.
async function createMasterListsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "master_lists" (
      "id" serial PRIMARY KEY NOT NULL,
      "category" text NOT NULL,
      "value" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "master_lists_category_value_uq"
      ON "master_lists" ("category", "value");
  `);
}

createMasterListsTable()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
