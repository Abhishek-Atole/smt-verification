DO $$ BEGIN
 CREATE TYPE "changeover_session_status" AS ENUM ('active', 'completed', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 CREATE TYPE "feeder_scan_status" AS ENUM ('verified', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "bom_items" ADD COLUMN IF NOT EXISTS "make_1" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN IF NOT EXISTS "mpn_1" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN IF NOT EXISTS "make_2" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN IF NOT EXISTS "mpn_2" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN IF NOT EXISTS "make_3" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN IF NOT EXISTS "mpn_3" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN IF NOT EXISTS "remarks" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "changeover_sessions" (
 "id" serial PRIMARY KEY NOT NULL,
 "operator_id" integer NOT NULL,
 "bom_id" integer NOT NULL,
 "status" "changeover_session_status" DEFAULT 'active' NOT NULL,
 "started_at" timestamp DEFAULT now() NOT NULL,
 "completed_at" timestamp,
 "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "feeder_scans" (
 "id" serial PRIMARY KEY NOT NULL,
 "session_id" integer NOT NULL,
 "feeder_number" text NOT NULL,
 "scanned_value" text NOT NULL,
 "matched_field" text,
 "matched_make" text,
 "lot_code" text,
 "status" "feeder_scan_status" NOT NULL,
 "scanned_at" timestamp DEFAULT now() NOT NULL,
 "operator_id" integer NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "changeover_sessions" ADD CONSTRAINT "changeover_sessions_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "changeover_sessions" ADD CONSTRAINT "changeover_sessions_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "boms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "feeder_scans" ADD CONSTRAINT "feeder_scans_session_id_changeover_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "changeover_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "feeder_scans" ADD CONSTRAINT "feeder_scans_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "changeover_sessions_operator_id_idx" ON "changeover_sessions" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changeover_sessions_bom_id_idx" ON "changeover_sessions" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changeover_sessions_status_idx" ON "changeover_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feeder_scans_session_id_idx" ON "feeder_scans" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feeder_scans_feeder_number_idx" ON "feeder_scans" USING btree ("feeder_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feeder_scans_status_idx" ON "feeder_scans" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feeder_scans_operator_id_idx" ON "feeder_scans" USING btree ("operator_id");