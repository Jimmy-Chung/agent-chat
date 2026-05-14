ALTER TABLE artifacts ADD COLUMN upload_status TEXT NOT NULL DEFAULT 'uploaded';
ALTER TABLE artifacts ADD COLUMN failure_code TEXT;
ALTER TABLE artifacts ADD COLUMN failure_message TEXT;
