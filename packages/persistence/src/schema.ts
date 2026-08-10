/**
 * SQLite schema for the Axle execution history.
 *
 * Structured, queryable columns (status, timestamps, repository) plus JSON for
 * nested value objects. Child tables keep steps, diagnostics, artifacts, and the
 * append-only event log independently addressable.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  intent TEXT,
  repository_json TEXT NOT NULL,
  change_json TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  limits_json TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_created ON executions(created_at);

CREATE TABLE IF NOT EXISTS execution_steps (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id),
  planned_step_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_code INTEGER,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  output_bytes INTEGER,
  truncated INTEGER
);
CREATE INDEX IF NOT EXISTS idx_steps_execution ON execution_steps(execution_id, ordinal);

CREATE TABLE IF NOT EXISTS diagnostics (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id),
  step_id TEXT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  file TEXT,
  line INTEGER,
  column_no INTEGER,
  raw_reference TEXT
);
CREATE INDEX IF NOT EXISTS idx_diag_execution ON diagnostics(execution_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  storage_key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_execution ON artifacts(execution_id);

CREATE TABLE IF NOT EXISTS execution_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_execution ON execution_events(execution_id, seq);
`;
