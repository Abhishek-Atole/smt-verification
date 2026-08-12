-- Add persisted verification mode to sessions and scan_records

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS verification_mode TEXT NOT NULL DEFAULT 'AUTO';

ALTER TABLE scan_records
  ALTER COLUMN verification_mode SET DEFAULT 'AUTO';

UPDATE scan_records
SET verification_mode = 'AUTO'
WHERE verification_mode IS NULL;

ALTER TABLE scan_records
  ALTER COLUMN verification_mode SET NOT NULL;
