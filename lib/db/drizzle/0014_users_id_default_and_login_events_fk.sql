-- Phase 1 hotfix migration
-- Fixes two bugs uncovered during admin route E2E verification (2026-06-25):
--   (a) users.id had no DB default → Drizzle inserts failed with NOT NULL violation
--   (b) login_events.user_id was ON DELETE SET NULL → admin hard-delete bypassed
--       the FK RESTRICT policy from PRD-PRODUCTION-READINESS.md line 204-205

ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE login_events DROP CONSTRAINT IF EXISTS login_events_user_id_fkey;
ALTER TABLE login_events
  ADD CONSTRAINT login_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
