-- Create reports table
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  report_type TEXT NOT NULL DEFAULT 'fpy',
  session_id INTEGER,
  bom_id INTEGER,
  filters JSONB DEFAULT '{}',
  format TEXT NOT NULL DEFAULT 'pdf',
  file_path TEXT,
  record_count INTEGER DEFAULT 0,
  query_time_ms INTEGER DEFAULT 0,
  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  generated_by TEXT NOT NULL,
  expires_at TIMESTAMP,
  deleted_at TIMESTAMP,
  deleted_by TEXT
);

-- Create indexes for reports table
CREATE INDEX idx_reports_type_date ON reports(report_type, generated_at);
CREATE INDEX idx_reports_generated_by ON reports(generated_by);
CREATE INDEX idx_reports_session_id ON reports(session_id);

-- Create report_exports table
CREATE TABLE IF NOT EXISTS report_exports (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  format TEXT NOT NULL,
  downloaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);

-- Create indexes for report_exports table
CREATE INDEX idx_report_exports_report_id ON report_exports(report_id);
CREATE INDEX idx_report_exports_user_id ON report_exports(user_id);
CREATE INDEX idx_report_exports_downloaded_at ON report_exports(downloaded_at);
