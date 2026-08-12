\timing on

\echo '=== TEST 1: MPN Lookup (bom_alternatives) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  ba.id,
  ba.rank,
  ba.make,
  ba.mpn,
  bli.id AS line_item_id,
  bli.feeder_number,
  bli.description
FROM bom_alternatives ba
JOIN bom_line_items bli ON bli.id = ba.line_item_id
JOIN bom_headers bh ON bh.id = bli.bom_header_id
WHERE bh.id = (SELECT id FROM bom_headers LIMIT 1)
  AND UPPER(ba.mpn) = UPPER('C0603C472K5RACAUTO')
ORDER BY ba.rank ASC
LIMIT 1;

\echo '=== TEST 2: UCAL Part Number Array Search ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, feeder_number, description, ucal_part_numbers
FROM bom_line_items
WHERE 'RDSCAP0353' = ANY(ucal_part_numbers)
  AND bom_header_id = (SELECT id FROM bom_headers LIMIT 1);

\echo '=== TEST 3: Progress Calculation ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
WITH changeover_data AS (
  SELECT c.id, c.bom_header_id
  FROM changeovers c
  LIMIT 1
),
total_feeders AS (
  SELECT COUNT(*) AS total
  FROM bom_line_items bli
  JOIN changeover_data cd ON cd.bom_header_id = bli.bom_header_id
),
verified_feeders AS (
  SELECT COUNT(DISTINCT vs.line_item_id) AS verified
  FROM verification_scans vs
  JOIN changeover_data cd ON cd.id = vs.changeover_id
)
SELECT
  verified,
  total,
  ROUND((verified::NUMERIC / NULLIF(total, 0)) * 100) AS percentage
FROM total_feeders, verified_feeders;

\echo '=== TEST 4: Role-Filtered Changeover List ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  c.id,
  c.status,
  c.line_number,
  c.shift,
  c.started_at,
  u.name AS operator_name,
  u.employee_id,
  bh.bom_number,
  bh.revision,
  COUNT(DISTINCT vs.id) AS scan_count,
  COUNT(DISTINCT sr.id) AS splice_count
FROM changeovers c
JOIN users u ON u.id = c.operator_id
JOIN bom_headers bh ON bh.id = c.bom_header_id
LEFT JOIN verification_scans vs ON vs.changeover_id = c.id
LEFT JOIN splice_records sr ON sr.changeover_id = c.id
WHERE c.operator_id = (SELECT id FROM users WHERE role = 'operator' LIMIT 1)
GROUP BY c.id, u.name, u.employee_id, bh.bom_number, bh.revision
ORDER BY c.started_at DESC
LIMIT 50;

\echo '=== TEST 5: Audit Log — Last 1000 Events ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  al.id,
  al.event_type,
  al.occurred_at,
  al.payload,
  u.name,
  u.employee_id
FROM audit_log al
JOIN users u ON u.id = al.user_id
WHERE al.changeover_id = (SELECT id FROM changeovers LIMIT 1)
ORDER BY al.occurred_at DESC
LIMIT 1000;

\echo '=== TEST 6: Unique Constraint Performance ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT EXISTS (
  SELECT 1 FROM verification_scans
  WHERE changeover_id = (SELECT id FROM changeovers LIMIT 1)
    AND line_item_id = (SELECT id FROM bom_line_items LIMIT 1)
) AS already_scanned;

\echo '=== TABLE ROW COUNTS ==='
SELECT
  schemaname,
  relname AS table_name,
  n_live_tup AS row_count,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;