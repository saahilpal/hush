CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT DEFAULT '',
  link TEXT DEFAULT '',
  created INTEGER NOT NULL,
  follow_at INTEGER NOT NULL,
  followups INTEGER DEFAULT 0,
  replied INTEGER DEFAULT 0,
  mx_provider TEXT DEFAULT 'unknown',
  last_self_view INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hits (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  why TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hits_email ON hits(email);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);
