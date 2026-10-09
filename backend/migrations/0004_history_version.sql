ALTER TABLE encounters ADD COLUMN entry_version INTEGER NOT NULL DEFAULT 1;
-- Existing synthetic/local data becomes visible at the migration-time entry
-- version. Earlier snapshots must pull a new state before reading its history.
UPDATE encounters SET entry_version=COALESCE((SELECT version FROM vocabulary_entries e WHERE e.user_id=encounters.user_id AND e.id=encounters.entry_id),1);
CREATE INDEX encounter_version_pages ON encounters(user_id,entry_id,entry_version,id);
