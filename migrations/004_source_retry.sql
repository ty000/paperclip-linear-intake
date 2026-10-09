ALTER TABLE plugin_linear_intake_e8c339297d.intake_requests
  ADD COLUMN source_retry_history jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(source_retry_history) = 'array' AND jsonb_array_length(source_retry_history) <= 2);
