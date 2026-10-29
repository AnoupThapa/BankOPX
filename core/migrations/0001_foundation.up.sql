-- Phase 1 foundation. Rules: SEC-06, SEC-12, CFG-01..08, WFL-03 (audit), TAT-01 (append-only), ADR-003 (institution_id everywhere)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Append-only guard shared by all immutable tables (SEC-06, CFG-08, ADR-004).
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TABLE institution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'NP',
  default_locale text NOT NULL DEFAULT 'en',
  timezone text NOT NULL DEFAULT 'Asia/Kathmandu',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, code)
);

-- Separate identity types (SEC-07).
CREATE TABLE user_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  actor_type text NOT NULL CHECK (actor_type IN ('customer','staff','admin','integration','auditor')),
  username text NOT NULL,
  password_hash text,
  mfa_secret text,
  mfa_enrolled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked','disabled')),
  failed_logins int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, username)
);

CREATE TABLE role_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  user_id uuid NOT NULL REFERENCES user_account(id),
  role text NOT NULL,
  -- ABAC scope attributes (SEC-12). Empty array = no access via this attribute, never "all".
  branch_ids uuid[] NOT NULL DEFAULT '{}',
  departments text[] NOT NULL DEFAULT '{}',
  products text[] NOT NULL DEFAULT '{}',
  max_amount numeric,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  granted_by uuid REFERENCES user_account(id),
  approved_by uuid REFERENCES user_account(id),   -- second approver for high-risk roles (APR-11)
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delegation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  from_user uuid NOT NULL REFERENCES user_account(id),
  to_user uuid NOT NULL REFERENCES user_account(id),
  role text NOT NULL,
  branch_ids uuid[] NOT NULL DEFAULT '{}',
  max_amount numeric,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  approved_by uuid REFERENCES user_account(id),
  revoked_at timestamptz,
  CHECK (valid_to > valid_from)
);

-- Sessions: token stored only as SHA-256 hash (IDN-09). Revocable, idle timeout.
CREATE TABLE app_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  user_id uuid NOT NULL REFERENCES user_account(id),
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  mfa_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- Append-only, hash-chained audit stream (ADR-004, ADR-021, SEC-06).
CREATE TABLE audit_event (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  institution_id uuid NOT NULL REFERENCES institution(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_type text NOT NULL,
  action text NOT NULL,
  object_type text,
  object_id text,
  reason text,
  prior_state text,
  new_state text,
  correlation_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  prev_hash text NOT NULL,
  hash text NOT NULL
);
CREATE INDEX audit_event_inst_seq ON audit_event (institution_id, seq);
CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Versioned configuration (ADR-005, CFG-*).
CREATE TABLE config_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  kind text NOT NULL,
  key text NOT NULL,
  disabled boolean NOT NULL DEFAULT false,     -- emergency-disable switch (CFG-04)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, kind, key)
);

CREATE TABLE config_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  definition_id uuid NOT NULL REFERENCES config_definition(id),
  version int NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','in_review','published','retired')),
  content jsonb NOT NULL,
  content_hash text NOT NULL,
  change_reason text NOT NULL,
  maker_id uuid NOT NULL REFERENCES user_account(id),
  checker_id uuid REFERENCES user_account(id),
  effective_from timestamptz,
  rollback_of uuid REFERENCES config_version(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (definition_id, version)
);

-- Published content is frozen; only the lifecycle may move published -> retired (CFG-02, FRM-03, WFL-07).
CREATE FUNCTION config_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published','retired') THEN
      RAISE EXCEPTION 'published config versions cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('published','retired') THEN
    IF NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash <> OLD.content_hash
       OR NEW.version <> OLD.version OR NEW.maker_id <> OLD.maker_id
       OR NEW.checker_id IS DISTINCT FROM OLD.checker_id
       OR NEW.change_reason <> OLD.change_reason
       OR NEW.definition_id <> OLD.definition_id THEN
      RAISE EXCEPTION 'published config version is immutable' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF OLD.status = 'retired' OR (OLD.status = 'published' AND NEW.status NOT IN ('published','retired')) THEN
      IF NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'illegal config status change % -> %', OLD.status, NEW.status USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER config_version_guard BEFORE UPDATE OR DELETE ON config_version FOR EACH ROW EXECUTE FUNCTION config_version_guard();

CREATE TABLE config_change_event (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  definition_id uuid NOT NULL REFERENCES config_definition(id),
  version_id uuid REFERENCES config_version(id),
  event text NOT NULL,
  actor_id uuid NOT NULL,
  reason text NOT NULL,
  diff jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER config_change_event_immutable BEFORE UPDATE OR DELETE ON config_change_event FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Idempotency (FRM-10, INT-02).
CREATE TABLE idempotency_record (
  institution_id uuid NOT NULL REFERENCES institution(id),
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb,
  status_code int,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, scope, key)
);

-- Row-level security: defence in depth for tenant isolation (SEC-02, ADR-003).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branch','user_account','role_assignment','delegation','app_session','audit_event',
                           'config_definition','config_version','config_change_event','idempotency_record'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)
                      WITH CHECK (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- Least-privilege application role. No UPDATE/DELETE on append-only tables (SEC-06).
GRANT USAGE ON SCHEMA public TO bbjp_app;
GRANT SELECT ON institution TO bbjp_app;
GRANT SELECT, INSERT, UPDATE ON branch, user_account, role_assignment, delegation, app_session, config_definition, idempotency_record TO bbjp_app;
GRANT SELECT, INSERT, UPDATE ON config_version TO bbjp_app;
GRANT SELECT, INSERT ON audit_event, config_change_event TO bbjp_app;
GRANT USAGE ON SEQUENCE audit_event_seq_seq, config_change_event_seq_seq TO bbjp_app;
