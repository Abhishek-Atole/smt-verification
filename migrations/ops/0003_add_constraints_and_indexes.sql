-- Migration: 0003_add_constraints_and_indexes.sql
-- Purpose: add missing FK on splice_records (after cleaning) and create recommended indexes.
-- NOTE: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Run steps sequentially on a live DB.

-- 1) Check for orphan splice_records (run first):
-- SELECT sr.id FROM splice_records sr LEFT JOIN feeders f ON f.id = sr.feeder_id WHERE f.id IS NULL LIMIT 10;

-- 2) FK constraint skipped: splice_records.feeder_id does not exist in the
-- live schema (the column was replaced by feeder_number text + line_item_id uuid).

-- 3) Create indexes concurrently (recommended):
-- Run these one-by-one on production to avoid long locks.
-- NOTE: live table is feeder_scans (not verification_scans — legacy name).
-- NOTE: live table is changeover_sessions (not changeovers).
-- NOTE: live table is bom_items (not bom_line_items).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feeder_scans_session_id ON feeder_scans(session_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_changeover_sessions_operator_id ON changeover_sessions(operator_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bom_items_bom_id ON bom_items(bom_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feeder_scans_scanned_at ON feeder_scans(scanned_at);

-- Down (undo) guidance (manual):
-- DROP INDEX CONCURRENTLY IF EXISTS idx_verification_scans_changeover_id;
-- ALTER TABLE splice_records DROP CONSTRAINT IF EXISTS fk_splice_feeder;
