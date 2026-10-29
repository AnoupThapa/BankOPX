-- Phase 3: applications (cases), immutable snapshots, return loop, documents. Rules: FRM-02..07/10, SUB-01/04, RET-01..05, DOC-01..09/11/12, WFL-03/04.

-- Drafts pin the form and service versions they started on (FRM-02, FRM-03, WFL-07).
ALTER TABLE customer_draft ADD COLUMN form_version_id uuid REFERENCES config_version(id), ADD COLUMN service_version_id uuid REFERENCES config_version(id);

CREATE TABLE app_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  tracking_code text NOT NULL UNIQUE,                 -- random locator, not a credential (SUB-01)
  profile_id uuid NOT NULL REFERENCES customer_profile(id),
  branch_id uuid REFERENCES branch(id),               -- scope attribute for staff access; null = visible to no branch until routing exists (Phase 4)
  service_key text NOT NULL,
  service_version_id uuid NOT NULL REFERENCES config_version(id),
  form_version_id uuid REFERENCES config_version(id),
  internal_state text NOT NULL CHECK (internal_state IN ('submitted','returned_to_customer','resubmitted')),
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_case_profile ON app_case (profile_id);

-- WFL-04: case state may only change inside the transition function, which sets a transaction-local marker.
CREATE FUNCTION app_case_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.internal_state IS DISTINCT FROM OLD.internal_state AND coalesce(current_setting('app.state_change_via', true), '') <> 'case-transitions' THEN
    RAISE EXCEPTION 'case state can only change through the transition service' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.tracking_code <> OLD.tracking_code OR NEW.profile_id <> OLD.profile_id OR NEW.service_version_id <> OLD.service_version_id
     OR NEW.form_version_id IS DISTINCT FROM OLD.form_version_id THEN
    RAISE EXCEPTION 'case identity and pinned versions are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER app_case_state_guard BEFORE UPDATE ON app_case FOR EACH ROW EXECUTE FUNCTION app_case_state_guard();
CREATE TRIGGER app_case_no_delete BEFORE DELETE ON app_case FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE case_transition (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL REFERENCES app_case(id),
  from_state text,
  to_state text NOT NULL,
  actor_id uuid NOT NULL,
  actor_type text NOT NULL,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER case_transition_immutable BEFORE UPDATE OR DELETE ON case_transition FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE application_snapshot (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL REFERENCES app_case(id),
  version int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('submission','resubmission')),
  form_version_id uuid REFERENCES config_version(id),
  data_enc text NOT NULL,
  data_hash text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version)
);
CREATE TRIGGER application_snapshot_immutable BEFORE UPDATE OR DELETE ON application_snapshot FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE info_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL REFERENCES app_case(id),
  reason_code text NOT NULL,
  customer_text text NOT NULL,                        -- explicitly authored for the customer (RET-01)
  items jsonb NOT NULL,                               -- [{type: field|document|question, key, text}] (RET-02)
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz
);
-- Internal notes: staff-only, never returned by any customer route (RET-03).
CREATE TABLE case_note (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL REFERENCES app_case(id),
  author_id uuid NOT NULL,
  body_enc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER case_note_immutable BEFORE UPDATE OR DELETE ON case_note FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Documents (DOC-*). Bytes live in the private object store, encrypted; only keys and hashes are here.
CREATE TABLE document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  profile_id uuid NOT NULL REFERENCES customer_profile(id),
  service_key text NOT NULL,
  requirement_key text NOT NULL,
  case_id uuid REFERENCES app_case(id),
  branch_id uuid REFERENCES branch(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One working document per requirement per application: before submission it is the profile's draft; after, the case's.
CREATE UNIQUE INDEX document_draft_unique ON document (profile_id, service_key, requirement_key) WHERE case_id IS NULL;
CREATE UNIQUE INDEX document_case_unique ON document (case_id, requirement_key) WHERE case_id IS NOT NULL;
CREATE TABLE document_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  document_id uuid NOT NULL REFERENCES document(id),
  seq int NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  mime text NOT NULL,
  size_bytes int NOT NULL,
  display_name text NOT NULL,
  source text NOT NULL CHECK (source IN ('camera','upload')),
  scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected','failed')),
  scanned_at timestamptz,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  UNIQUE (document_id, seq)
);
-- Everything except the scan result is immutable; the scan result moves only from 'pending' (DOC-02, DOC-03, DOC-05).
CREATE FUNCTION document_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'document versions are never deleted' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF (to_jsonb(NEW) - 'scan_status' - 'scanned_at') IS DISTINCT FROM (to_jsonb(OLD) - 'scan_status' - 'scanned_at') THEN
    RAISE EXCEPTION 'document versions are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.scan_status IS DISTINCT FROM OLD.scan_status AND OLD.scan_status <> 'pending' THEN
    RAISE EXCEPTION 'scan result is final' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_version_guard BEFORE UPDATE OR DELETE ON document_version FOR EACH ROW EXECUTE FUNCTION document_version_guard();
CREATE UNIQUE INDEX document_version_idem ON document_version (document_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE document_review (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  version_id uuid NOT NULL REFERENCES document_version(id),
  outcome text NOT NULL CHECK (outcome IN ('accepted','rejected','unclear','expired','missing','original_required','duplicate')),
  reason_code text,
  customer_message text,
  reviewer_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER document_review_immutable BEFORE UPDATE OR DELETE ON document_review FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE document_access_event (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  version_id uuid NOT NULL REFERENCES document_version(id),
  actor_id uuid NOT NULL,
  actor_type text NOT NULL,
  action text NOT NULL CHECK (action IN ('view','download','link_issued','upload')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER document_access_event_immutable BEFORE UPDATE OR DELETE ON document_access_event FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_case','case_transition','application_snapshot','info_request','case_note','document','document_version','document_review','document_access_event'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)
                      WITH CHECK (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON app_case, info_request, document, document_version TO bbjp_app;
GRANT SELECT, INSERT ON case_transition, application_snapshot, case_note, document_review, document_access_event TO bbjp_app;
GRANT USAGE ON SEQUENCE case_transition_seq_seq, application_snapshot_seq_seq, case_note_seq_seq, document_review_seq_seq, document_access_event_seq_seq TO bbjp_app;
GRANT DELETE ON customer_draft TO bbjp_app;   -- a submitted draft is consumed; the immutable snapshot is the record
