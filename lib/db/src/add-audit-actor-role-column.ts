import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 9.2: add actor_role to audit_logs so each event records the role of
// the actor at event time. Idempotent ADD COLUMN.
async function addAuditActorRoleColumn() {
  await db.execute(sql`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_role" text;`);
}

addAuditActorRoleColumn()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
