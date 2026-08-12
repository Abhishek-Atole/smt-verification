-- Phase 2-B (PRD §2.2) — rename the `engineer` enum value on UserRole to `supervisor`.
-- PG 10+ atomically rewrites every column that uses the enum. No row scan.
-- `users.role` is the only column using "UserRole".
ALTER TYPE "UserRole" RENAME VALUE 'engineer' TO 'supervisor';
