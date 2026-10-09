-- Normal creation still rejects source collisions inside the atomic write
-- guard. Explicitly confirmed new lifecycles may share a normalized spelling.
DROP INDEX live_vocabulary_key;
CREATE INDEX live_vocabulary_key ON vocabulary_entries(user_id,normalized_key) WHERE deleted=0;
