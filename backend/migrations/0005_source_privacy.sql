ALTER TABLE users ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 0 CHECK(source_revision >= 0 AND source_revision <= 9007199254740991);
CREATE TABLE source_removals (
  user_id TEXT NOT NULL REFERENCES users(id),
  id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  PRIMARY KEY(user_id,id)
);
