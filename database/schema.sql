CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','dosen','mahasiswa')),
  nim TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE TABLE IF NOT EXISTS devices (
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  PRIMARY KEY (user_id, device_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id, device_id) REFERENCES devices(user_id, device_id)
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  lecturer_id TEXT NOT NULL REFERENCES users(id),
  finalized_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'draft' CHECK (sync_status IN ('draft','pending','synced')),
  synced_at TEXT
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  score REAL CHECK (score BETWEEN 0 AND 100),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (class_id, student_id)
);
CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY,
  grade_id INTEGER NOT NULL UNIQUE REFERENCES grades(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
  synced_at TEXT NOT NULL,
  UNIQUE (student_id, class_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  time TEXT NOT NULL,
  request_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  device TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('allow','deny')),
  reason TEXT NOT NULL,
  status INTEGER
);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_classes_lecturer ON classes(lecturer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(time);
