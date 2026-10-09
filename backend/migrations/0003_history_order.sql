ALTER TABLE vocabulary_entries ADD COLUMN history_ordering TEXT NOT NULL DEFAULT 'retained';
ALTER TABLE encounters ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
-- Earlier local Worker writes inserted each confirmed chunk in request order.
WITH positions AS (
  SELECT rowid AS encounter_row, ROW_NUMBER() OVER (PARTITION BY user_id,entry_id ORDER BY rowid) AS ordinal FROM encounters
)
UPDATE encounters SET position=(SELECT ordinal FROM positions WHERE encounter_row=encounters.rowid);
CREATE UNIQUE INDEX encounter_position ON encounters(user_id,entry_id,position);
