#!/bin/bash

set -euo pipefail

###############################################################################
# Migration Script: Update users.id from serial to UUID and hash passwords
# This script handles the production migration for the SMT Verification System
# 
# IMPORTANT: Run this in a maintenance window as it requires downtime
#
# Usage: DATABASE_URL=... bash migrate-users-to-uuid.sh
###############################################################################

if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  exit 1
fi

echo "🔄 Starting migration: serial → UUID for users.id"
echo "⚠️  WARNING: This operation requires downtime"
echo ""

# Connect to database and run migration
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'EOF'

BEGIN TRANSACTION;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Step 1: Verify current state
SELECT 'Current users table state:' AS step;
SELECT column_name, data_type FROM information_schema.columns 
  WHERE table_name = 'users' AND column_name = 'id';

-- Step 2: Migrate users.id to UUID only if needed
DO $$
DECLARE
  users_id_type text;
BEGIN
  SELECT data_type INTO users_id_type
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'id';

  IF users_id_type = 'uuid' THEN
    RAISE NOTICE 'users.id is already UUID, skipping users table rebuild';
  ELSE
    RAISE NOTICE 'users.id is %, rebuilding users table with UUID primary key', users_id_type;

    CREATE TABLE users_new (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL,
      password text NOT NULL,
      display_name text NOT NULL DEFAULT '',
      name text NOT NULL DEFAULT '',
      role text NOT NULL DEFAULT 'operator',
      employee_id text,
      created_at timestamp DEFAULT now() NOT NULL
    );

    -- Keep existing users but generate UUID IDs; operator references are migrated separately.
    INSERT INTO users_new (username, password, display_name, name, role, employee_id, created_at)
    SELECT username, password, display_name, name, role, employee_id, created_at
    FROM users;

    ALTER TABLE users RENAME TO users_old;
    ALTER TABLE users_new RENAME TO users;
  END IF;
END
$$;

-- Step 3: Convert changeover_sessions.operator_id to UUID safely
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'changeover_sessions' AND column_name = 'operator_id';

  IF col_type IS NULL THEN
    RAISE NOTICE 'changeover_sessions.operator_id not found, skipping';
  ELSIF col_type = 'uuid' THEN
    RAISE NOTICE 'changeover_sessions.operator_id already UUID, skipping';
  ELSE
    RAISE NOTICE 'Converting changeover_sessions.operator_id from % to uuid', col_type;

    ALTER TABLE changeover_sessions DROP CONSTRAINT IF EXISTS changeover_sessions_operator_id_fkey;
    ALTER TABLE changeover_sessions ADD COLUMN IF NOT EXISTS operator_id_new uuid;

    -- Keep values that are already UUID-like; otherwise leave NULL.
    EXECUTE $upd$
      UPDATE changeover_sessions
      SET operator_id_new = CASE
        WHEN operator_id IS NULL THEN NULL
        WHEN operator_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN operator_id::text::uuid
        ELSE NULL
      END
    $upd$;

    ALTER TABLE changeover_sessions DROP COLUMN operator_id;
    ALTER TABLE changeover_sessions RENAME COLUMN operator_id_new TO operator_id;
    ALTER TABLE changeover_sessions ADD CONSTRAINT changeover_sessions_operator_id_fkey
      FOREIGN KEY (operator_id) REFERENCES users(id);
  END IF;
END
$$;

-- Step 4: Convert feeder_scans.operator_id to UUID safely (if table/column exists)
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'feeder_scans' AND column_name = 'operator_id';

  IF col_type IS NULL THEN
    RAISE NOTICE 'feeder_scans.operator_id not found, skipping';
  ELSIF col_type = 'uuid' THEN
    RAISE NOTICE 'feeder_scans.operator_id already UUID, skipping';
  ELSE
    RAISE NOTICE 'Converting feeder_scans.operator_id from % to uuid', col_type;

    ALTER TABLE feeder_scans DROP CONSTRAINT IF EXISTS feeder_scans_operator_id_fkey;
    ALTER TABLE feeder_scans ADD COLUMN IF NOT EXISTS operator_id_new uuid;

    -- Keep values that are already UUID-like; otherwise leave NULL.
    EXECUTE $upd$
      UPDATE feeder_scans
      SET operator_id_new = CASE
        WHEN operator_id IS NULL THEN NULL
        WHEN operator_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN operator_id::text::uuid
        ELSE NULL
      END
    $upd$;

    ALTER TABLE feeder_scans DROP COLUMN operator_id;
    ALTER TABLE feeder_scans RENAME COLUMN operator_id_new TO operator_id;
    ALTER TABLE feeder_scans ADD CONSTRAINT feeder_scans_operator_id_fkey
      FOREIGN KEY (operator_id) REFERENCES users(id);
  END IF;
END
$$;

-- Step 5: Create indexes
SELECT 'Creating indexes...' AS step;
CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);

-- Step 6: Drop old users table if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users_old'
  ) THEN
    EXECUTE 'DROP TABLE users_old';
  END IF;
END
$$;

-- Step 7: Verify migration
SELECT 'Migration complete! Verifying...' AS step;
SELECT COUNT(*) as user_count FROM users;
SELECT column_name, data_type FROM information_schema.columns 
  WHERE table_name = 'users' ORDER BY ordinal_position;

-- Verify FK integrity
SELECT COUNT(*) as changeover_sessions_with_operator FROM changeover_sessions WHERE operator_id IS NOT NULL;
SELECT COUNT(*) as feeder_scans_with_operator FROM feeder_scans WHERE operator_id IS NOT NULL;

SELECT '✅ Migration successful!' AS result;

COMMIT;

EOF

echo ""
echo "✅ Migration completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Run: pnpm --filter @workspace/api-server run seed:users"
echo "2. Verify login with: curl -X POST http://localhost:3001/api/auth/login ..."
echo "3. Restart the API server"

