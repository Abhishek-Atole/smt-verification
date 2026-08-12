-- Session handover & QA verification features
-- Adds columns for 200% verification, shift handover, and extended session status.

-- Extend session status enum
ALTER TYPE changeover_session_status ADD VALUE IF NOT EXISTS 'pending_qa';
ALTER TYPE changeover_session_status ADD VALUE IF NOT EXISTS 'qa_in_review';
ALTER TYPE changeover_session_status ADD VALUE IF NOT EXISTS 'qa_confirmed';
ALTER TYPE changeover_session_status ADD VALUE IF NOT EXISTS 'handed_over';
ALTER TYPE changeover_session_status ADD VALUE IF NOT EXISTS 'active_splicing';
ALTER TYPE changeover_session_status ADD VALUE IF NOT EXISTS 'incomplete';

-- Create QA result enum
DO $$ BEGIN
  CREATE TYPE qa_result AS ENUM ('pass', 'fail', 'alternate_accepted', 'pending');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- changeover_sessions: QA verification & handover columns
ALTER TABLE changeover_sessions
  ADD COLUMN IF NOT EXISTS qa_verified_by_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS qa_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS qa_verification_method text,
  ADD COLUMN IF NOT EXISTS qa_discrepancy_found boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS handed_over_to_operator_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS handed_over_to_supervisor_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS handed_over_at timestamptz,
  ADD COLUMN IF NOT EXISTS handover_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS handover_accepted_by_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS changeover_operator_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS changeover_supervisor_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS splicing_operator_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS qa_lock_expires_at timestamptz;

-- feeder_scans: QA verification columns
ALTER TABLE feeder_scans
  ADD COLUMN IF NOT EXISTS qa_verified_by_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS qa_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS qa_result qa_result,
  ADD COLUMN IF NOT EXISTS qa_notes text;

-- splice_records: QA verification columns
ALTER TABLE splice_records
  ADD COLUMN IF NOT EXISTS qa_verified_by_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS qa_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS qa_result qa_result;

-- Create handover audit trail table
CREATE TABLE IF NOT EXISTS session_handovers (
  id                SERIAL PRIMARY KEY,
  session_id        text NOT NULL REFERENCES changeover_sessions(id),
  from_operator_id  uuid NOT NULL REFERENCES users(id),
  from_supervisor_id uuid REFERENCES users(id),
  to_operator_id    uuid NOT NULL REFERENCES users(id),
  to_supervisor_id  uuid REFERENCES users(id),
  initiated_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at       timestamptz,
  status            text NOT NULL DEFAULT 'pending',
  notes             text
);

CREATE INDEX IF NOT EXISTS idx_session_handovers_session_id ON session_handovers(session_id);
CREATE INDEX IF NOT EXISTS idx_session_handovers_to_operator ON session_handovers(to_operator_id);
CREATE INDEX IF NOT EXISTS idx_session_handovers_status ON session_handovers(status);
