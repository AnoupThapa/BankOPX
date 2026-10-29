DROP TABLE IF EXISTS customer_draft, consent_record, otp_request_log, otp_challenge, customer_field_value, customer_contact, customer_profile CASCADE;
ALTER TABLE app_session DROP COLUMN IF EXISTS stepup_at;
