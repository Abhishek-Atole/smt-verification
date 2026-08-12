-- Migration: Change changeover_sessions and feeder_scans ID format from SERIAL to TEXT (SMT_YYYYMMDD_NNNNNN)
-- Date: 2026-04-25

-- Step 1: Drop dependent foreign key constraint first
ALTER TABLE feeder_scans DROP CONSTRAINT IF EXISTS feeder_scans_session_id_changeover_sessions_id_fk;

-- Step 2: Add new text id column to changeover_sessions
ALTER TABLE changeover_sessions ADD COLUMN id_new TEXT;

-- Step 3: Generate new IDs in SMT_YYYYMMDD_NNNNNN format
-- For existing records, generate IDs based on their creation date
UPDATE changeover_sessions
SET id_new = 'SMT_' || TO_CHAR(created_at, 'YYYYMMDD') || '_' || LPAD(CAST(ROW_NUMBER() OVER (PARTITION BY DATE(created_at) ORDER BY id) AS TEXT), 6, '0')
WHERE id_new IS NULL;

-- Step 4: Make id_new NOT NULL
ALTER TABLE changeover_sessions ALTER COLUMN id_new SET NOT NULL;

-- Step 5: Drop indexes that reference the old id
DROP INDEX IF EXISTS changeover_sessions_operator_id_idx;
DROP INDEX IF EXISTS changeover_sessions_bom_id_idx;
DROP INDEX IF EXISTS changeover_sessions_status_idx;

-- Step 6: Drop the old primary key from changeover_sessions
ALTER TABLE changeover_sessions DROP CONSTRAINT changeover_sessions_pkey;

-- Step 7: Drop the old id column from changeover_sessions
ALTER TABLE changeover_sessions DROP COLUMN id;

-- Step 8: Rename the new id column to id
ALTER TABLE changeover_sessions RENAME COLUMN id_new TO id;

-- Step 9: Add the new primary key constraint to changeover_sessions
ALTER TABLE changeover_sessions ADD PRIMARY KEY (id);

-- Step 10: Update feeder_scans session_id to text
ALTER TABLE feeder_scans ADD COLUMN session_id_new TEXT;

-- Step 11: Populate the new session_id_new column with values from changeover_sessions
UPDATE feeder_scans fs
SET session_id_new = cs.id
FROM changeover_sessions cs
WHERE fs.session_id = cs.id;

-- Step 12: Make session_id_new NOT NULL
ALTER TABLE feeder_scans ALTER COLUMN session_id_new SET NOT NULL;

-- Step 13: Drop the old session_id column from feeder_scans
ALTER TABLE feeder_scans DROP COLUMN session_id;

-- Step 14: Rename the new session_id column to session_id
ALTER TABLE feeder_scans RENAME COLUMN session_id_new TO session_id;

-- Step 15: Add the foreign key constraint back to feeder_scans with matching types
ALTER TABLE feeder_scans ADD CONSTRAINT feeder_scans_session_id_changeover_sessions_id_fk 
  FOREIGN KEY (session_id) REFERENCES changeover_sessions(id) ON DELETE CASCADE;

-- Step 16: Recreate indexes for changeover_sessions
CREATE INDEX IF NOT EXISTS changeover_sessions_operator_id_idx ON changeover_sessions(operator_id);
CREATE INDEX IF NOT EXISTS changeover_sessions_bom_id_idx ON changeover_sessions(bom_id);
CREATE INDEX IF NOT EXISTS changeover_sessions_status_idx ON changeover_sessions(status);

-- Step 17: Recreate index on the new session_id
CREATE INDEX IF NOT EXISTS feeder_scans_session_id_idx ON feeder_scans(session_id);

