ALTER TABLE users ADD COLUMN reminder_device_id TEXT;
ALTER TABLE users ADD COLUMN reminder_revision INTEGER NOT NULL DEFAULT 0;
