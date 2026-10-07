-- Read-only metadata preflight; never fetches tickets, credentials or tokens.
-- Required psql variables: company_id and connection_id (both UUIDs).
-- Use native/operator DB access, never embed DB credentials in this repository.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
WITH target AS (
  SELECT :'company_id'::uuid AS company_id, :'connection_id'::uuid AS connection_id
), connection AS (
  SELECT c.id, c.company_id, c.application_id, c.transport, c.auth_kind,
    c.status, c.enabled, c.health_status, c.config, c.credential_secret_refs,
    c.last_catalog_refresh_at
  FROM tool_connections c JOIN target t
    ON c.company_id = t.company_id AND c.id = t.connection_id
)
SELECT json_build_object(
  'schema', 'linear-intake-recipe-metadata.v1',
  'observed_at', statement_timestamp(),
  'transaction_read_only', current_setting('transaction_read_only'),
  'connection_found', c.id IS NOT NULL,
  'transport', c.transport,
  'auth_kind', c.auth_kind,
  'status', c.status,
  'enabled', c.enabled,
  'health_status', c.health_status,
  'catalog_count', (SELECT count(*) FROM tool_catalog_entries e WHERE e.connection_id = c.id AND e.company_id = c.company_id),
  'last_catalog_refresh_at', c.last_catalog_refresh_at,
  'official_linear_mcp_url', c.config->>'url' = 'https://mcp.linear.app/mcp',
  'browser_authorization_configured', c.config->'oauth'->>'grantType' = 'authorization_code',
  'oauth_read_requested', (c.config->'oauth'->'scopes') ? 'read',
  'oauth_write_requested', (c.config->'oauth'->'scopes') ? 'write',
  'oauth_client_id_present', coalesce(length(c.config->'oauth'->>'clientId'), 0) > 0,
  'client_secret_reference_present', EXISTS (
    SELECT 1 FROM jsonb_array_elements(c.credential_secret_refs) r
      WHERE r->>'configPath' = 'oauth.client_secret'
  ),
  'grant_count', (SELECT count(*) FROM connection_grants g WHERE g.company_id = c.company_id AND g.connection_id = c.id),
  'grant_provider_tenant_count', (SELECT count(*) FROM connection_grants g WHERE g.company_id = c.company_id AND g.connection_id = c.id AND g.provider_tenant IS NOT NULL),
  'explicit_profile_reference_count', (SELECT count(*) FROM tool_profile_entries e
    WHERE e.company_id = c.company_id AND (e.connection_id = c.id OR e.application_id = c.application_id)),
  'native_source_qualified', false
) FROM target t LEFT JOIN connection c ON c.id = t.connection_id;
ROLLBACK;
