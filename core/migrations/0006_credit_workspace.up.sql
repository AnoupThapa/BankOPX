-- Phase 6: credit review workspace. Rules: CRD-01..10, APR-06, DEC-*, WFL-07. The workspace records facts, runs approved calculations and records human
-- judgement. Nothing here decides: approval remains a workflow decision by an authorised person.

-- One proposal per case. Configuration versions are pinned when it is opened (CFG, WFL-07 spirit): later publications never change an open proposal.
CREATE TABLE credit_proposal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL UNIQUE REFERENCES app_case(id),
  branch_id uuid REFERENCES branch(id),
  tracking_code text NOT NULL,
  service_key text NOT NULL,
  product_class text NOT NULL,
  proposal_type_version_id uuid NOT NULL REFERENCES config_version(id),
  checklist_version_id uuid NOT NULL REFERENCES config_version(id),
  calculation_version_id uuid NOT NULL REFERENCES config_version(id),
  scorecard_version_id uuid REFERENCES config_version(id),
  requested_amount numeric(24,6) NOT NULL CHECK (requested_amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  tenor_months int CHECK (tenor_months IS NULL OR tenor_months BETWEEN 1 AND 1200),
  purpose_enc text,
  created_by uuid NOT NULL REFERENCES user_account(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION credit_proposal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.case_id <> OLD.case_id OR NEW.product_class <> OLD.product_class OR NEW.proposal_type_version_id <> OLD.proposal_type_version_id OR NEW.checklist_version_id <> OLD.checklist_version_id
     OR NEW.calculation_version_id <> OLD.calculation_version_id OR NEW.scorecard_version_id IS DISTINCT FROM OLD.scorecard_version_id THEN
    RAISE EXCEPTION 'proposal identity and pinned configuration are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_proposal_guard BEFORE UPDATE ON credit_proposal FOR EACH ROW EXECUTE FUNCTION credit_proposal_guard();

CREATE TABLE credit_party (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  proposal_id uuid NOT NULL REFERENCES credit_proposal(id),
  role text NOT NULL,
  name_enc text NOT NULL,                         -- personal data: encrypted at rest (SEC)
  note text,
  added_by uuid NOT NULL REFERENCES user_account(id),
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_party_proposal ON credit_party (proposal_id);

-- Proposal-level financial and other inputs. Append-only: a correction is a new row; calculations use the latest row per key and source (per-party and per-period inputs are not built yet, A-040).
CREATE TABLE credit_input (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  proposal_id uuid NOT NULL REFERENCES credit_proposal(id),
  key text NOT NULL,
  value numeric(24,8) NOT NULL,
  as_of date NOT NULL,
  source text NOT NULL CHECK (source IN ('customer_declared','document','external_check','staff_entered','resolution')),
  evidence_note text,
  entered_by uuid NOT NULL REFERENCES user_account(id),
  entered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_input_proposal ON credit_input (proposal_id, key, seq);
CREATE TRIGGER credit_input_immutable BEFORE UPDATE OR DELETE ON credit_input FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Every calculation and score run is kept with the inputs it used (reproducible, CRD-03, CRD-10). System output, labelled as such.
CREATE TABLE credit_assessment (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  proposal_id uuid NOT NULL REFERENCES credit_proposal(id),
  kind text NOT NULL CHECK (kind IN ('calculation','score')),
  inputs_used jsonb NOT NULL,
  result jsonb NOT NULL,
  engine_version text NOT NULL,
  run_by uuid NOT NULL REFERENCES user_account(id),
  run_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_assessment_proposal ON credit_assessment (proposal_id, kind, seq);
CREATE TRIGGER credit_assessment_immutable BEFORE UPDATE OR DELETE ON credit_assessment FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE credit_checklist_answer (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  proposal_id uuid NOT NULL REFERENCES credit_proposal(id),
  item_key text NOT NULL,
  answer text NOT NULL CHECK (answer IN ('met','not_met','not_applicable')),
  note text,
  answered_by uuid NOT NULL REFERENCES user_account(id),
  answered_at timestamptz NOT NULL DEFAULT now(),
  CHECK (answer = 'met' OR (note IS NOT NULL AND length(btrim(note)) > 0))
);
CREATE INDEX credit_checklist_proposal ON credit_checklist_answer (proposal_id, item_key, seq);
CREATE TRIGGER credit_checklist_immutable BEFORE UPDATE OR DELETE ON credit_checklist_answer FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Human judgement, separate from any system score (CRD-06). Append-only: a revised recommendation is a new row.
CREATE TABLE credit_recommendation (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  proposal_id uuid NOT NULL REFERENCES credit_proposal(id),
  recommendation text NOT NULL CHECK (recommendation IN ('support','support_with_conditions','not_support')),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  exceptions text,
  mitigants text,
  concerns text,
  score_override jsonb,                           -- { reason, evidence, higherApprovalRequired } when the officer departs from the system score
  recommended_by uuid NOT NULL REFERENCES user_account(id),
  recommended_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_recommendation_proposal ON credit_recommendation (proposal_id, seq);
CREATE TRIGGER credit_recommendation_immutable BEFORE UPDATE OR DELETE ON credit_recommendation FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Conditions and covenants (docs/10 §6). Clearing needs a different person than the one who set it up (APR-06) and evidence.
CREATE TABLE credit_condition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  proposal_id uuid NOT NULL REFERENCES credit_proposal(id),
  branch_id uuid REFERENCES branch(id),
  kind text NOT NULL CHECK (kind IN ('pre_disbursement','post_disbursement','covenant')),
  text text NOT NULL CHECK (length(btrim(text)) > 0),
  evidence_requirement text NOT NULL CHECK (length(btrim(evidence_requirement)) > 0),
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','cleared')),
  created_by uuid NOT NULL REFERENCES user_account(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_by uuid REFERENCES user_account(id),
  cleared_at timestamptz,
  clearance_note text,
  CHECK (status = 'open' OR (cleared_by IS NOT NULL AND cleared_at IS NOT NULL AND clearance_note IS NOT NULL AND cleared_by <> created_by))
);
CREATE INDEX credit_condition_proposal ON credit_condition (proposal_id);
CREATE INDEX credit_condition_due ON credit_condition (branch_id, status, due_date);
CREATE OR REPLACE FUNCTION credit_condition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'cleared' THEN RAISE EXCEPTION 'a cleared condition is final' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF NEW.proposal_id <> OLD.proposal_id OR NEW.kind <> OLD.kind OR NEW.text <> OLD.text OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'a condition can only be cleared, not rewritten' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_condition_guard BEFORE UPDATE ON credit_condition FOR EACH ROW EXECUTE FUNCTION credit_condition_guard();
CREATE TRIGGER credit_condition_nodelete BEFORE DELETE ON credit_condition FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['credit_proposal','credit_party','credit_input','credit_assessment','credit_checklist_answer','credit_recommendation','credit_condition'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)
                      WITH CHECK (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON credit_proposal, credit_condition TO bbjp_app;
GRANT SELECT, INSERT ON credit_party, credit_input, credit_assessment, credit_checklist_answer, credit_recommendation TO bbjp_app;
GRANT USAGE ON SEQUENCE credit_input_seq_seq, credit_assessment_seq_seq, credit_checklist_answer_seq_seq, credit_recommendation_seq_seq TO bbjp_app;
