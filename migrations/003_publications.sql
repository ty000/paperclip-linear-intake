CREATE TABLE plugin_linear_intake_e8c339297d.campaign_publication_bindings (
  company_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  binding_sha256 text NOT NULL,
  binding jsonb NOT NULL,
  source_sha256 text NOT NULL,
  retained_request jsonb NOT NULL,
  PRIMARY KEY (company_id, mission_id)
);

CREATE TABLE plugin_linear_intake_e8c339297d.campaign_publications (
  company_id uuid NOT NULL,
  intent_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  payload_sha256 text NOT NULL,
  payload jsonb NOT NULL,
  effects jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, intent_id),
  FOREIGN KEY (company_id, mission_id) REFERENCES plugin_linear_intake_e8c339297d.campaign_publication_bindings(company_id, mission_id)
);
