import { sql } from "drizzle-orm";
import { db } from "./index";

// Surgical bootstrap for the approvers table. `drizzle-kit push` requires an
// interactive TTY to resolve unrelated schema drift on the dev DB; this creates
// ONLY the approvers table + its unique index, idempotently, touching nothing
// else. Structure mirrors schema/approvers.ts exactly, so a later push sees no
// diff for this table.
async function createApproversTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "approvers" (
      "id" serial PRIMARY KEY NOT NULL,
      "category" text NOT NULL,
      "name" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "approvers_category_name_uq"
      ON "approvers" ("category", "name");
  `);
}

createApproversTable()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
