CREATE TABLE plugin_linear_intake_e8c339297d.import_plans (
  company_id uuid NOT NULL,
  intake_id text NOT NULL,
  activation_id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  request_version integer NOT NULL CHECK (request_version > 0),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  plan jsonb NOT NULL,
  effect_keys jsonb NOT NULL CHECK (jsonb_typeof(effect_keys) = 'array'),
  state text NOT NULL CHECK (state IN ('preparing', 'prepared', 'blocked', 'outcome_unknown')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  readiness jsonb,
  readiness_sha256 text CHECK (readiness_sha256 IS NULL OR readiness_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text,
  PRIMARY KEY (company_id, intake_id),
  CHECK ((readiness IS NULL) = (readiness_sha256 IS NULL)),
  CHECK (state <> 'prepared' OR readiness IS NOT NULL)
);

CREATE TABLE plugin_linear_intake_e8c339297d.import_effects (
  company_id uuid NOT NULL,
  effect_key text NOT NULL,
  kind text NOT NULL,
  intent jsonb NOT NULL,
  intent_sha256 text NOT NULL CHECK (intent_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('intended', 'dispatched', 'observed', 'outcome_unknown')),
  dispatch_count integer NOT NULL DEFAULT 0 CHECK (dispatch_count IN (0, 1)),
  dispatch_owner text,
  result jsonb,
  result_sha256 text CHECK (result_sha256 IS NULL OR result_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text,
  PRIMARY KEY (company_id, effect_key),
  CHECK ((dispatch_count = 0) = (dispatch_owner IS NULL)),
  CHECK ((result IS NULL) = (result_sha256 IS NULL)),
  CHECK (state <> 'observed' OR result IS NOT NULL)
);

CREATE TABLE plugin_linear_intake_e8c339297d.import_plan_effects (
  company_id uuid NOT NULL,
  intake_id text NOT NULL,
  effect_key text NOT NULL,
  PRIMARY KEY (company_id, intake_id, effect_key),
  FOREIGN KEY (company_id, intake_id) REFERENCES plugin_linear_intake_e8c339297d.import_plans (company_id, intake_id),
  FOREIGN KEY (company_id, effect_key) REFERENCES plugin_linear_intake_e8c339297d.import_effects (company_id, effect_key)
);

CREATE INDEX import_plans_candidates ON plugin_linear_intake_e8c339297d.import_plans (company_id, activation_id, state);
CREATE INDEX import_plan_effects_by_effect ON plugin_linear_intake_e8c339297d.import_plan_effects (company_id, effect_key);
