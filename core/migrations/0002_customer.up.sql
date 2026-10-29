-- Phase 2: customer identity, profile, consent, drafts. Rules: IDN-01..06, PRF-01..04, SEC-02/10, PRV-04, ADR-019.
ALTER TABLE app_session ADD COLUMN stepup_at timestamptz;   -- IDN-06: last strong re-authentication

CREATE TABLE customer_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  user_id uuid NOT NULL UNIQUE REFERENCES user_account(id),       -- the customer-type identity (SEC-07)
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  completion_state text NOT NULL DEFAULT 'contact_verified' CHECK (completion_state IN ('contact_verified','consent_recorded')),
  home_branch_id uuid REFERENCES branch(id),
  core_customer_ref text UNIQUE,                                   -- null until linked (IDN-03)
  link_method text,
  linked_at timestamptz,
  locale text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Contact values are encrypted; lookups use a keyed HMAC so a stolen table does not reveal phone numbers.
CREATE TABLE customer_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  profile_id uuid NOT NULL REFERENCES customer_profile(id),
  channel text NOT NULL CHECK (channel IN ('email','mobile')),
  value_enc text NOT NULL,
  lookup_hash text NOT NULL,
  verified_at timestamptz NOT NULL,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, channel, lookup_hash)
);

-- PRF-02/03: per-field verification status with source and date.
CREATE TABLE customer_field_value (
  profile_id uuid NOT NULL REFERENCES customer_profile(id),
  institution_id uuid NOT NULL REFERENCES institution(id),
  field_key text NOT NULL,
  value_enc text NOT NULL,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified','unverified')),
  source text NOT NULL,
  source_date timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  PRIMARY KEY (profile_id, field_key)
);

CREATE TABLE otp_challenge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  purpose text NOT NULL CHECK (purpose IN ('signin','stepup')),
  channel text NOT NULL CHECK (channel IN ('email','mobile')),
  lookup_hash text NOT NULL,
  profile_id uuid REFERENCES customer_profile(id),          -- set for step-up
  code_hmac text NOT NULL,                                    -- never the code itself
  destination_enc text,                                       -- sign-in only; encrypted, cleared once the challenge is consumed (PRV-01)
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Abuse accounting (IDN-01, SEC-10). Values are keyed hashes only.
CREATE TABLE otp_request_log (
  id bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  kind text NOT NULL CHECK (kind IN ('destination','ip','link')),
  subject_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_request_log_lookup ON otp_request_log (institution_id, kind, subject_hash, created_at);

CREATE TABLE consent_record (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  profile_id uuid NOT NULL REFERENCES customer_profile(id),
  notice_version_id uuid NOT NULL REFERENCES config_version(id),
  notice_hash text NOT NULL,
  purpose text NOT NULL,
  consent_type text NOT NULL CHECK (consent_type IN ('required','marketing')),
  granted boolean NOT NULL,
  session_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER consent_record_immutable BEFORE UPDATE OR DELETE ON consent_record FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE customer_draft (
  profile_id uuid NOT NULL REFERENCES customer_profile(id),
  institution_id uuid NOT NULL REFERENCES institution(id),
  service_key text NOT NULL,
  data_enc text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, service_key)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_profile','customer_contact','customer_field_value','otp_challenge','otp_request_log','consent_record','customer_draft'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)
                      WITH CHECK (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON customer_profile, customer_contact, customer_field_value, otp_challenge, customer_draft TO bbjp_app;
GRANT SELECT, INSERT ON otp_request_log, consent_record TO bbjp_app;
GRANT USAGE ON SEQUENCE otp_request_log_id_seq, consent_record_seq_seq TO bbjp_app;
