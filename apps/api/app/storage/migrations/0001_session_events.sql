CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  type TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_seq
ON session_events(session_id, seq);
