-- Scan / splice idempotency
--
-- A network blip on factory WiFi commonly causes the client to retry an
-- in-flight POST. Without protection the same scan was being recorded
-- twice, corrupting FPY metrics and paste-jar consumption counts.
--
-- These partial unique indexes collapse retries of the same payload
-- arriving within the same wall-clock second to a single row. The route
-- handler catches the resulting 23505 unique_violation and replies as if
-- the original insert succeeded, so the client never sees a 500.
--
-- COALESCE on nullable columns is required because PostgreSQL treats
-- NULL as distinct from NULL in unique indexes — without it, two NULL
-- values would not collide and retries with NULL payloads would slip
-- through.
--
-- NOTE: if the live DB already contains exact-duplicate rows from before
-- this change, CREATE UNIQUE INDEX will fail. Find them with the query
-- below and dedup (keep smallest id) before re-applying this migration:
--
--   SELECT session_id, feeder_number, scanned_value,
--          date_trunc('second', scanned_at) AS bucket, count(*)
--   FROM feeder_scans
--   GROUP BY 1,2,3,4
--   HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_feeder_scan_idempotency"
  ON "feeder_scans" (
    "session_id",
    "feeder_number",
    "scanned_value",
    (date_trunc('second', "scanned_at"))
  );

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_scan_record_idempotency"
  ON "scan_records" (
    "session_id",
    "feeder_number",
    COALESCE("spool_barcode", ''),
    COALESCE("internal_id_scanned", ''),
    (date_trunc('second', "scanned_at"))
  );

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_splice_record_idempotency"
  ON "splice_records" (
    "changeover_id",
    COALESCE("feeder_number", ''),
    COALESCE("new_spool_mpn", ''),
    COALESCE("new_spool_lot", ''),
    (date_trunc('second', "spliced_at"))
  );
