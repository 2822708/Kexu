ALTER TABLE todo ADD COLUMN chain_generated BOOLEAN NOT NULL DEFAULT FALSE;

-- Already completed occurrences cannot safely be replayed after upgrading.
UPDATE todo SET chain_generated = TRUE
WHERE recurring_id IS NOT NULL AND completed = TRUE;
