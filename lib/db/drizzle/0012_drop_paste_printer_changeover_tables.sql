-- Drop solder paste tables (CASCADE handles FK dependencies)
DROP TABLE IF EXISTS paste_return_log CASCADE;
DROP TABLE IF EXISTS paste_jar_stages CASCADE;
DROP TABLE IF EXISTS paste_fifo_counters CASCADE;
DROP TABLE IF EXISTS paste_jars CASCADE;

-- Drop printer changeover table
DROP TABLE IF EXISTS printer_changeovers CASCADE;
