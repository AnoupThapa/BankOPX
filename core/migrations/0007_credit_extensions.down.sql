DROP TABLE IF EXISTS credit_external_check CASCADE;
ALTER TABLE credit_condition DROP COLUMN IF EXISTS overdue_flagged_at;
DROP INDEX IF EXISTS credit_input_party;
ALTER TABLE credit_input DROP COLUMN IF EXISTS party_id;
