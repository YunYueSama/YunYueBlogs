/* 短期播放地址及取源协调，不保存音频或用户业务内容。 */
CREATE TABLE IF NOT EXISTS music_resolutions (
  cache_key TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  result_json TEXT CHECK(result_json IS NULL OR length(result_json) <= 8192),
  expires_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0,
  failure_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(cache_key, source_revision)
);
CREATE INDEX IF NOT EXISTS music_resolutions_expiry ON music_resolutions(expires_at);
