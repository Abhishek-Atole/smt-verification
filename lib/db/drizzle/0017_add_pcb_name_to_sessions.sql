-- Free Scan Mode: PCB / panel name entered manually (no BOM to derive it from).
-- Nullable; populated only for free-scan sessions.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pcb_name text;
