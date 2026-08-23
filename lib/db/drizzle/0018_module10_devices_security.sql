-- Module 10 — devices + security_settings (device categories, IP restriction,
-- admin-configurable security settings). Idempotent so it can be re-applied.

DO $$ BEGIN
  CREATE TYPE "device_type" AS ENUM ('end_device', 'admin_device', 'store_device', 'server');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "device_status" AS ENUM ('active', 'blocked', 'pending');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "devices" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "device_type"       "device_type" NOT NULL,
  "device_name"       text NOT NULL,
  "allowed_ip"        text NOT NULL,
  "mac_address"       text,
  "status"            "device_status" NOT NULL DEFAULT 'pending',
  "created_by"        text,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "last_modified_by"  text,
  "last_modified_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "devices_device_type_idx" ON "devices" ("device_type");
CREATE INDEX IF NOT EXISTS "devices_status_idx" ON "devices" ("status");

CREATE TABLE IF NOT EXISTS "security_settings" (
  "id"                              boolean PRIMARY KEY DEFAULT true,
  "maintenance_mode"                boolean NOT NULL DEFAULT false,
  "failed_attempt_threshold"        integer NOT NULL DEFAULT 5,
  "session_timeout_end_device_sec"  integer NOT NULL DEFAULT 1800,
  "session_timeout_store_device_sec" integer NOT NULL DEFAULT 1800,
  "session_timeout_admin_device_sec" integer NOT NULL DEFAULT 900,
  "updated_by"                      text,
  "updated_at"                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "security_settings_single_row" CHECK ("id" = true)
);

-- Seed the single settings row (defaults) if absent.
INSERT INTO "security_settings" ("id") VALUES (true)
ON CONFLICT ("id") DO NOTHING;
