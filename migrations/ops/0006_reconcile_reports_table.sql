-- 0006_reconcile_reports_table.sql
-- Reconciles the live `reports` table to the Drizzle ORM shape
-- (lib/db/src/schema/reports.ts) so report-history saving works again.
--
-- WHY: two conflicting definitions of `reports` exist in the migration set.
--   0002_smooth_stone_men.sql created an OLD shape (query_execution_time,
--   file_size, session_id/bom_id NOT NULL, no query_time); 0006_add_reporting_tables.sql
--   declares the ORM shape but used `CREATE TABLE IF NOT EXISTS`, so it silently
--   skipped on any database where 0002 had already run. The reconciling Drizzle
--   migration referenced in the meta snapshots (0004_spicy_diamondback) was never
--   applied. Result: every aggregate report export (/api/reports/export/:type)
--   wrote its file then failed inserting the history row with
--   `column "query_time" of relation "reports" does not exist` → HTTP 500.
--
-- FRESH installs already get the correct shape via `drizzle push` (which reads
-- the Drizzle schema) — this script is only for upgrading EXISTING databases.
-- Idempotent: safe to re-run. All steps are existence/state-guarded.

BEGIN;

-- 1. Drop columns that only exist in the legacy 0002 shape.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'reports' AND column_name = 'file_size') THEN
    ALTER TABLE reports DROP COLUMN file_size;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'reports' AND column_name = 'query_execution_time') THEN
    ALTER TABLE reports DROP COLUMN query_execution_time;
  END IF;
END $$;

-- 2. Add query_time if absent (ORM column: query_time integer DEFAULT 0).
ALTER TABLE reports ADD COLUMN IF NOT EXISTS query_time integer DEFAULT 0;

-- 3. session_id / bom_id are nullable in the ORM (aggregate reports carry no
--    session/bom). Legacy NOT NULL must be lifted or NULL inserts are rejected.
ALTER TABLE reports ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN bom_id DROP NOT NULL;

-- 4. Align column defaults with the ORM (report_type 'fpy', format 'pdf',
--    record_count 0). No-ops when already correct.
ALTER TABLE reports ALTER COLUMN report_type SET DEFAULT 'fpy';
ALTER TABLE reports ALTER COLUMN format SET DEFAULT 'pdf';
ALTER TABLE reports ALTER COLUMN record_count SET DEFAULT 0;

-- 5. filters: json -> jsonb with a DEFAULT '{}' (ORM uses jsonb, default {}).
--    The USING-COALESCE cast also backfills any NULL filters as '{}'.
ALTER TABLE reports ALTER COLUMN filters TYPE jsonb
  USING COALESCE(filters::text, '{}')::jsonb;
ALTER TABLE reports ALTER COLUMN filters SET DEFAULT '{}'::jsonb;

COMMIT;
