-- @optional
-- Vincolo di esclusione: due blocchi dello stesso operatore non possono sovrapporsi.
-- Se l'estensione btree_gist non fosse disponibile, il sistema resta protetto dal lock transazionale (advisory lock).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE busy_blocks ADD CONSTRAINT busy_blocks_no_overlap
  EXCLUDE USING gist (staff_id WITH =, during WITH &&);
