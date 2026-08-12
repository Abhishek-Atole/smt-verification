-- Add deleted_by column to sessions table for soft delete tracking
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_by text;

-- Create index on deleted_at for soft delete queries
CREATE INDEX IF NOT EXISTS sessions_deleted_at_idx ON sessions(deleted_at);
