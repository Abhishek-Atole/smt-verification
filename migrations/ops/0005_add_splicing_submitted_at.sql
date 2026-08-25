-- 0005_add_splicing_submitted_at.sql
-- Adds sessions.splicing_submitted_at: the timestamp the operator submitted
-- splicing to QA (status qa_confirmed -> splicing_pending_qa). Drives the
-- 2-hour QA-confirmation countdown shown in the QA queue. Display-only:
-- overdue rows are flagged, never auto-closed.
--
-- Nullable; existing rows stay NULL (no countdown until the next submit).
-- FRESH installs get this column automatically via `drizzle push` (which reads
-- the Drizzle schema) — this script is only for upgrading EXISTING databases.
-- Idempotent: safe to re-run.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS splicing_submitted_at timestamp;
