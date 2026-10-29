-- Phase 6b: party-scoped inputs, external checks through an authorised port, overdue-condition flags. Rules: CRD-04, CRD-09, docs/10 §6.

-- A financial input may belong to one party (co-applicant, guarantor, owner ...). Proposal-level inputs keep party_id NULL.
ALTER TABLE credit_input ADD COLUMN party_id uuid REFERENCES credit_party(id);
CREATE INDEX credit_input_party ON credit_input (proposal_id, key, party_id, seq);

-- Result of an external check (bureau or similar). The platform stores a reference and the bank-defined summary fields, never a raw report.
-- The lawful basis and the evidence of the customer's consent are mandatory (CRD-09). Append-only: each step (requested, sent, received, failed, unavailable) is a row; the latest row per
-- correlation ID is the state. The call to the provider is made by the dispatcher, never inside a request (ADR-017).
CREATE TABLE credit_external_check (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  proposal_id uuid NOT NULL REFERENCES credit_proposal(id),
  party_id uuid REFERENCES credit_party(id),
  provider text NOT NULL,
  correlation_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','sent','received','failed','unavailable')),
  result_ref text,
  summary jsonb,
  error_code text,
  lawful_basis text NOT NULL CHECK (length(btrim(lawful_basis)) > 0),
  consent_evidence text NOT NULL CHECK (length(btrim(consent_evidence)) > 0),
  requested_by uuid NOT NULL REFERENCES user_account(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'received' OR result_ref IS NOT NULL)
);
CREATE INDEX credit_external_check_proposal ON credit_external_check (proposal_id, seq);
CREATE TRIGGER credit_external_check_immutable BEFORE UPDATE OR DELETE ON credit_external_check FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE credit_external_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_external_check FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_external_check USING (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)
  WITH CHECK (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid);
GRANT SELECT, INSERT ON credit_external_check TO bbjp_app;
GRANT USAGE ON SEQUENCE credit_external_check_seq_seq TO bbjp_app;

-- An overdue open condition is flagged once. The flag is the only column besides clearance that may change on an open condition.
ALTER TABLE credit_condition ADD COLUMN overdue_flagged_at timestamptz;
CREATE OR REPLACE FUNCTION credit_condition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'cleared' THEN RAISE EXCEPTION 'a cleared condition is final' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF NEW.proposal_id <> OLD.proposal_id OR NEW.kind <> OLD.kind OR NEW.text <> OLD.text OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'a condition can only be cleared, not rewritten' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
