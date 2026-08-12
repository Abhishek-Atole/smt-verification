-- Phase 2-A — refresh_tokens table per BACKEND-SCHEMA §5.2 + §14.1 (U7 fingerprint/jti additions)
-- Combined into a single migration so we don't ALTER a table we just created.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   VARCHAR(64) NOT NULL UNIQUE,
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  replaced_by  UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  user_agent   VARCHAR(255),
  ip           INET,
  -- U7: session fingerprinting (TRD §6.3, PRD §11.7)
  fingerprint  VARCHAR(64),
  jti          UUID NOT NULL DEFAULT gen_random_uuid()
);

CREATE INDEX IF NOT EXISTS idx_rt_user_id     ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_rt_expires_at  ON refresh_tokens(expires_at);
-- idx_rt_token_hash implied by UNIQUE constraint above.
