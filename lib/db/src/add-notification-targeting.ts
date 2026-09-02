import { sql } from "drizzle-orm";
import { db } from "./index";

// Module 14 — notification bell scope + auto-clear. Surgical, idempotent
// migration mirroring schema/notifications.ts. Adds the targeting/classification
// columns to `notifications` and creates the per-user `notification_seen` table.
// All new columns are nullable so existing rows and un-targeted inserts stay
// valid; a later `drizzle-kit push` sees no diff.
async function addNotificationTargeting() {
  await db.execute(sql`
    ALTER TABLE "notifications"
      ADD COLUMN IF NOT EXISTS "event_class" text,
      ADD COLUMN IF NOT EXISTS "target_role" text,
      ADD COLUMN IF NOT EXISTS "target_user_id" text,
      ADD COLUMN IF NOT EXISTS "related_entity_type" text,
      ADD COLUMN IF NOT EXISTS "related_entity_id" text,
      ADD COLUMN IF NOT EXISTS "created_by_user_id" text;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "notifications_target_role_idx"
      ON "notifications" ("target_role");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "notifications_target_user_idx"
      ON "notifications" ("target_user_id");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "notification_seen" (
      "id" serial PRIMARY KEY NOT NULL,
      "notification_id" integer NOT NULL REFERENCES "notifications"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL,
      "seen_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "notification_seen_user_notif_idx"
      ON "notification_seen" ("notification_id", "user_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "notification_seen_user_idx"
      ON "notification_seen" ("user_id");
  `);
}

addNotificationTargeting()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
