ALTER TABLE todo ADD COLUMN chain_generated BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE todo SET chain_generated = TRUE
WHERE recurring_id IS NOT NULL AND completed = TRUE;
