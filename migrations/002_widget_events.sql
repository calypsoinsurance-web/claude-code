-- Raw events reported by the Fetch quote widget on our page. Stored as received and NEVER counted as quotes:
-- the meaning and payload of the widget's "complete" event are not documented in the material we have.
CREATE TABLE widget_events (
  id INTEGER PRIMARY KEY,
  visitor_id TEXT,
  event TEXT NOT NULL CHECK (event IN ('ready','init','complete','error')),
  payload_json TEXT NOT NULL,
  page_url TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX widget_events_created ON widget_events(created_at);
