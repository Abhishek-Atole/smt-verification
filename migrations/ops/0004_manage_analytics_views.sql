-- Migration: 0004_manage_analytics_views.sql
-- Purpose: create materialized views for analytics with down (drop) statements. Run in staging first.

-- UP
-- NOTE: live table is feeder_scans (not verification_scans — legacy name).
-- Status values (feeder_scan_status enum): verified, failed, duplicate.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_mpn_usage AS
  SELECT scanned_value AS mpn, count(*) AS usage_count
  FROM feeder_scans
  GROUP BY scanned_value;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mv_mpn_usage_mpn ON mv_mpn_usage(mpn);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_session_summary AS
  SELECT session_id,
         count(*) FILTER (WHERE status = 'verified') AS pass_count,
         count(*) FILTER (WHERE status = 'failed')   AS fail_count
  FROM feeder_scans
  GROUP BY session_id;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mv_session_summary_session_id ON mv_session_summary(session_id);

-- DOWN
DROP MATERIALIZED VIEW IF EXISTS mv_mpn_usage;
DROP MATERIALIZED VIEW IF EXISTS mv_changeover_summary;
