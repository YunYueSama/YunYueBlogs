PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
  password_version INTEGER NOT NULL DEFAULT 1, bootstrap_hash TEXT, bootstrap_expires INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES admin_users(id),
  csrf_token TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '', metadata TEXT NOT NULL DEFAULT '{}', publish INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, revision_token TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(kind,slug)
);
CREATE INDEX IF NOT EXISTS documents_kind_updated ON documents(kind,archived,updated_at);
CREATE TABLE IF NOT EXISTS document_revisions (
  document_id TEXT NOT NULL REFERENCES documents(id), revision INTEGER NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, metadata TEXT NOT NULL, slug TEXT NOT NULL,
  publish INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(document_id,revision)
);
CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
  snapshot TEXT NOT NULL, snapshot_hash TEXT NOT NULL, commit_sha TEXT, deployment_url TEXT,
  error TEXT, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS releases_one_active ON releases((1)) WHERE state IN ('queued','exporting','building','verifying','promoting');
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, object_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
