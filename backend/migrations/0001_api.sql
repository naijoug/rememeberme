PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL UNIQUE, login TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC', sync_context INTEGER NOT NULL DEFAULT 0,
  sync_urls INTEGER NOT NULL DEFAULT 0, sync_epoch TEXT NOT NULL,
  created_at REAL NOT NULL, deleted_at REAL
);
CREATE TABLE devices (
  user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, name TEXT NOT NULL,
  created_at REAL NOT NULL, revoked_at REAL, PRIMARY KEY(user_id,id)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE, access_expires_at REAL NOT NULL,
  refresh_expires_at REAL NOT NULL, revoked_at REAL,
  FOREIGN KEY(user_id,device_id) REFERENCES devices(user_id,id)
);
CREATE TABLE auth_flows (
  state_hash TEXT PRIMARY KEY, client_state TEXT NOT NULL, challenge TEXT NOT NULL,
  callback TEXT NOT NULL, device_name TEXT NOT NULL, provider_verifier TEXT NOT NULL,
  expires_at REAL NOT NULL, claimed_by TEXT, code_hash TEXT UNIQUE,
  user_id TEXT REFERENCES users(id), code_expires_at REAL, redeemed_by TEXT
);
CREATE TABLE vocabulary_entries (
  user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, normalized_key TEXT NOT NULL COLLATE BINARY,
  word TEXT NOT NULL, kind TEXT NOT NULL, count REAL CHECK(count IS NULL OR (count >= 0 AND count <= 1.7976931348623157e308)),
  definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), notes TEXT NOT NULL,
  created_at REAL NOT NULL, updated_at REAL NOT NULL, version INTEGER NOT NULL CHECK(version >= 1),
  deleted INTEGER NOT NULL DEFAULT 0, review_json TEXT CHECK(review_json IS NULL OR json_valid(review_json)),
  review_version INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,id)
);
CREATE UNIQUE INDEX live_vocabulary_key ON vocabulary_entries(user_id,normalized_key) WHERE deleted=0;
CREATE TABLE encounters (
  user_id TEXT NOT NULL, id TEXT NOT NULL, entry_id TEXT NOT NULL, timestamp REAL NOT NULL,
  definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), context TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '', immutable_hash TEXT NOT NULL, PRIMARY KEY(user_id,id),
  FOREIGN KEY(user_id,entry_id) REFERENCES vocabulary_entries(user_id,id)
);
CREATE INDEX encounter_pages ON encounters(user_id,entry_id,timestamp,id);
CREATE TABLE review_events (
  user_id TEXT NOT NULL, id TEXT NOT NULL, entry_id TEXT NOT NULL, event_json TEXT NOT NULL,
  PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,entry_id) REFERENCES vocabulary_entries(user_id,id)
);
CREATE TABLE review_admissions (
  user_id TEXT NOT NULL, local_day TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(user_id,event_id)
);
CREATE INDEX admission_day ON review_admissions(user_id,local_day);
CREATE TABLE sync_operations (
  user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)), committed_at REAL NOT NULL,
  PRIMARY KEY(user_id,id)
);
CREATE TABLE sync_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id),
  entry_id TEXT NOT NULL, version INTEGER NOT NULL, entry_json TEXT NOT NULL CHECK(json_valid(entry_json))
);
CREATE INDEX user_changes ON sync_changes(user_id,sequence);
CREATE INDEX snapshot_entries ON sync_changes(user_id,entry_id,sequence);
-- Transient CHECK guards convert failed conditional writes into batch rollback.
CREATE TABLE write_guards (nonce TEXT PRIMARY KEY, allowed INTEGER NOT NULL CHECK(allowed=1));
