-- What the importer saw around the table: lines above the header, and total/note rows it skipped.
ALTER TABLE imports ADD COLUMN notes_json TEXT;
