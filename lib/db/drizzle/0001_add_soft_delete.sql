-- Add soft delete support to sessions table
ALTER TABLE "sessions" ADD COLUMN "deleted_at" timestamp;

-- Create index for efficient trash queries
CREATE INDEX "idx_sessions_deleted_at" ON "sessions" ("deleted_at");
