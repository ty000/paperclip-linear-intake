CREATE TABLE plugin_linear_intake_e8c339297d.campaign_source_changes (
  company_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  generation bigint GENERATED ALWAYS AS IDENTITY CHECK (generation > 0 AND generation <= 2147483647),
  provider_delivery_id uuid NOT NULL,
  source_event_id text NOT NULL,
  raw_body_sha256 text NOT NULL,
  event jsonb NOT NULL,
  PRIMARY KEY (company_id, mission_id, source_event_id),
  UNIQUE (company_id, mission_id, provider_delivery_id)
);

CREATE TABLE plugin_linear_intake_e8c339297d.campaign_continuity_responses (
  company_id uuid NOT NULL,
  challenge_id uuid NOT NULL,
  request_sha256 text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (company_id, challenge_id)
);
