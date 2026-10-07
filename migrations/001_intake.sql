CREATE TABLE plugin_linear_intake_e8c339297d.intake_binding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  company_id uuid NOT NULL UNIQUE,
  activation_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  authority jsonb NOT NULL,
  active boolean NOT NULL,
  version integer NOT NULL CHECK (version > 0)
);

CREATE TABLE plugin_linear_intake_e8c339297d.intake_deliveries (
  company_id uuid NOT NULL,
  provider_delivery_id uuid NOT NULL,
  activation_id uuid NOT NULL,
  raw_body_sha256 text NOT NULL CHECK (raw_body_sha256 ~ '^[0-9a-f]{64}$'),
  source_event_id text NOT NULL CHECK (source_event_id ~ '^[0-9a-f]{64}$'),
  normalized_event jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  applied boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, provider_delivery_id)
);

CREATE TABLE plugin_linear_intake_e8c339297d.intake_requests (
  company_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  intake_id text NOT NULL UNIQUE,
  activation_id uuid NOT NULL,
  accepted boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('received', 'fetching', 'source_observed', 'withdrawn', 'blocked')),
  version integer NOT NULL CHECK (version > 0),
  revision timestamptz NOT NULL,
  event_at timestamptz NOT NULL,
  classification text NOT NULL CHECK (classification IN ('received', 'withdrawal')),
  delivery_id uuid NOT NULL,
  accepted_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner text,
  lease_until timestamptz,
  snapshot jsonb,
  snapshot_sha256 text CHECK (snapshot_sha256 IS NULL OR snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text,
  PRIMARY KEY (company_id, organization_id, issue_id),
  CHECK (accepted = (accepted_at IS NOT NULL)),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
  CHECK ((snapshot IS NULL) = (snapshot_sha256 IS NULL)),
  CHECK (status <> 'source_observed' OR snapshot IS NOT NULL)
);

CREATE INDEX intake_deliveries_pending ON plugin_linear_intake_e8c339297d.intake_deliveries (company_id, activation_id, applied, received_at);
CREATE INDEX intake_requests_pending ON plugin_linear_intake_e8c339297d.intake_requests (company_id, activation_id, status, accepted_at);
