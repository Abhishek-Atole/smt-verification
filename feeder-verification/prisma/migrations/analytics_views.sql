-- Read-only analytics performance layer.
-- Run manually with: psql $DATABASE_URL -f prisma/migrations/analytics_views.sql

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_changeover_summary AS
SELECT
  c.id AS changeover_id,
  c.operator_id,
  u.name AS operator_name,
  u.employee_id,
  c.bom_header_id,
  bh.bom_number,
  c.line_number,
  c.shift,
  c.status,
  c.started_at,
  c.completed_at,
  EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) / 60.0 AS duration_minutes,
  COUNT(DISTINCT vs.id) AS total_scans,
  COUNT(DISTINCT vs.id) FILTER (WHERE vs.is_alternate = true) AS alternate_scans,
  COUNT(DISTINCT sr.id) AS total_splices,
  DATE_TRUNC('day', c.started_at) AS job_date
FROM changeovers c
JOIN users u ON u.id = c.operator_id
JOIN bom_headers bh ON bh.id = c.bom_header_id
LEFT JOIN verification_scans vs ON vs.changeover_id = c.id
LEFT JOIN splice_records sr ON sr.changeover_id = c.id
GROUP BY c.id, u.name, u.employee_id, bh.bom_number;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_changeover_summary_id ON mv_changeover_summary(changeover_id);
CREATE INDEX IF NOT EXISTS idx_mv_changeover_summary_date ON mv_changeover_summary(job_date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_changeover_summary_operator ON mv_changeover_summary(operator_id, job_date DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_feeder_errors AS
SELECT
  COALESCE(bli.feeder_number, al.payload->>'feeder') AS feeder_number,
  MAX(bli.description) AS description,
  MAX(bli.package_desc) AS package_desc,
  bh.bom_number,
  DATE_TRUNC('day', al.occurred_at) AS error_date,
  COUNT(*) FILTER (WHERE al.event_type = 'scan_fail') AS error_count,
  COUNT(*) FILTER (WHERE al.event_type = 'scan_ok') AS success_count
FROM audit_log al
JOIN changeovers c ON c.id = al.changeover_id
JOIN bom_headers bh ON bh.id = c.bom_header_id
LEFT JOIN bom_line_items bli ON bli.bom_header_id = bh.id AND bli.feeder_number = al.payload->>'feeder'
WHERE al.event_type IN ('scan_fail', 'scan_ok')
GROUP BY COALESCE(bli.feeder_number, al.payload->>'feeder'), bh.bom_number, DATE_TRUNC('day', al.occurred_at);

CREATE INDEX IF NOT EXISTS idx_mv_feeder_errors_feeder ON mv_feeder_errors(feeder_number, error_date DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_operator_daily AS
SELECT
  u.id AS operator_id,
  u.name AS operator_name,
  u.employee_id,
  DATE_TRUNC('day', c.started_at) AS work_date,
  COUNT(DISTINCT c.id) AS changeovers_completed,
  AVG(EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) / 60.0) AS avg_duration_minutes,
  COUNT(DISTINCT vs.id) AS total_scans,
  COUNT(DISTINCT vs.id) FILTER (WHERE vs.is_alternate = true) AS alternate_scans,
  COUNT(DISTINCT al_fail.id) AS scan_failures,
  CASE
    WHEN COUNT(DISTINCT vs.id) + COUNT(DISTINCT al_fail.id) = 0 THEN 100
    ELSE ROUND(COUNT(DISTINCT vs.id)::numeric / NULLIF(COUNT(DISTINCT vs.id) + COUNT(DISTINCT al_fail.id), 0) * 100, 2)
  END AS accuracy_pct
FROM users u
JOIN changeovers c ON c.operator_id = u.id
LEFT JOIN verification_scans vs ON vs.changeover_id = c.id
LEFT JOIN audit_log al_fail ON al_fail.changeover_id = c.id AND al_fail.event_type = 'scan_fail'
WHERE u.role = 'operator'
  AND c.status IN ('verified', 'splicing', 'complete')
GROUP BY u.id, u.name, u.employee_id, DATE_TRUNC('day', c.started_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_operator_daily_unique ON mv_operator_daily(operator_id, work_date);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_mpn_usage AS
SELECT
  ba.mpn,
  ba.make,
  ba.rank,
  CASE
    WHEN ba.rank = 1 THEN 'PRIMARY'
    WHEN ba.rank = 2 THEN 'ALTERNATE_1'
    ELSE 'ALTERNATE_2'
  END AS mpn_type,
  bli.feeder_number,
  bh.bom_number,
  COUNT(vs.id) AS times_used,
  MIN(vs.scanned_at) AS first_used,
  MAX(vs.scanned_at) AS last_used
FROM bom_alternatives ba
JOIN bom_line_items bli ON bli.id = ba.line_item_id
JOIN bom_headers bh ON bh.id = bli.bom_header_id
LEFT JOIN verification_scans vs ON vs.alternative_id = ba.id
GROUP BY ba.mpn, ba.make, ba.rank, bli.feeder_number, bh.bom_number;

CREATE INDEX IF NOT EXISTS idx_mv_mpn_usage_feeder ON mv_mpn_usage(feeder_number, bom_number);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_splice_frequency AS
SELECT
  bli.feeder_number,
  DATE_TRUNC('day', sr.spliced_at) AS splice_date,
  COUNT(*) AS splice_count,
  MAX(sr.spliced_at) AS last_spliced
FROM splice_records sr
JOIN bom_line_items bli ON bli.id = sr.line_item_id
GROUP BY bli.feeder_number, DATE_TRUNC('day', sr.spliced_at);

CREATE INDEX IF NOT EXISTS idx_mv_splice_frequency ON mv_splice_frequency(feeder_number, splice_date DESC);
