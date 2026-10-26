-- Retry metadata only: raw credentials and request IDs are never stored.
ALTER TABLE sessions ADD COLUMN rotation_hash TEXT;
ALTER TABLE sessions ADD COLUMN rotated_to TEXT;
ALTER TABLE sessions ADD COLUMN rotation_expires_at REAL;
