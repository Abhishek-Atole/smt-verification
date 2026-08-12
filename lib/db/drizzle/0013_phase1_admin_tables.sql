-- Phase 1: Admin dashboard support tables
-- - audit_logs.chain_hash: HMAC-SHA256 chain hash for integrity (U6)
-- - login_events: per-attempt login activity for admin viewer
-- - db_size_log: daily DB size for trend chart (U18)
-- - backup_schedules + backup_runs: backup orchestration

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_hash VARCHAR(64);

CREATE TABLE IF NOT EXISTS login_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  employee_id     TEXT,
  ip              TEXT,
  user_agent      TEXT,
  result          TEXT NOT NULL,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_events_created_at_idx ON login_events (created_at DESC);
CREATE INDEX IF NOT EXISTS login_events_user_id_idx ON login_events (user_id);

CREATE TABLE IF NOT EXISTS db_size_log (
  date        DATE PRIMARY KEY,
  size_bytes  BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backup_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_expr       TEXT NOT NULL DEFAULT '0 2 * * *',
  retention_days  INTEGER NOT NULL DEFAULT 30,
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backup_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id     UUID REFERENCES backup_schedules(id) ON DELETE SET NULL,
  triggered_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running',
  file_path       TEXT,
  size_bytes      BIGINT,
  error_message   TEXT
);
CREATE INDEX IF NOT EXISTS backup_runs_started_at_idx ON backup_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS backup_runs_status_idx ON backup_runs (status);
