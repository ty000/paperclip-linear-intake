ALTER TABLE plugin_linear_intake_e8c339297d.campaign_publication_bindings
  ADD COLUMN resume_version INTEGER NOT NULL DEFAULT 0 CHECK (resume_version >= 0),
  ADD COLUMN source_hold BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN source_diagnostic JSONB;
