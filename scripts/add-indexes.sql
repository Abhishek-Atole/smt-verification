-- Performance indexes for 20k+ changeover_sessions
-- Run with: psql "$DATABASE_URL" -f scripts/add-indexes.sql
-- All CREATE INDEX CONCURRENTLY — zero downtime on live data.

-- Composite: status + operator_id (QA queue, operator's session filters)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_cs_status_operator ON changeover_sessions (status, operator_id);

-- Composite: status + bom_id (BOM-filtered session queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_cs_status_bom ON changeover_sessions (status, bom_id);

-- Descending started_at (used by all ORDER BY startedAt DESC queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_cs_started_desc ON changeover_sessions (started_at DESC);

-- feeder_scans: session_id + qa_result (the GROUP BY aggregate in Fix 2)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_fs_session_qa ON feeder_scans (session_id, qa_result);

-- feeder_scans: session_id (general scan lookups by session)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_fs_session ON feeder_scans (session_id);

-- Report created indexes
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE tablename IN ('changeover_sessions', 'feeder_scans')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
