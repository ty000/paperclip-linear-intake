# Recipe access continuation — 7 October 2026

**Historical snapshot before operator OAuth completion.** The operator has
since authorized the recipe connection; subsequent read-only metadata showed
it active/healthy with 68 catalog entries. The [local transport continuation](LOCAL-TRANSPORT.md)
supersedes the HTTPS-only next-step requirement below. The receipt is preserved
as evidence of the earlier state; it is not the current connection verdict.

**Result: blocked on connection authorization and supported gateway reachability.**
This continuation replaces assumptions about the recipe with a scoped,
read-only observation. It does not advance Lot 1 acceptance or start Lot 2.

## Observed recipe state

The existing recipe Linear connection was identified by application metadata,
then all further queries were scoped to its exact company and connection IDs.
The public [metadata receipt](recipe-metadata-2026-10-07.json) excludes those IDs,
names, URLs containing identifiers, secret IDs/values, token hashes and tickets.

- Authenticated/private Paperclip recipe still listens on loopback; its user
  service is active. No public URL is configured in the instance configuration.
- The Linear connection is `mcp_remote` / `oauth`, `draft`, disabled and
  `unchecked`; the catalog is empty and has never been refreshed.
- The official Linear MCP URL and browser `authorization_code` flow are
  configured. A client ID and native client-secret reference exist.
- One organization grant exists, but its provider-tenant metadata is absent.
  Inspection of reference paths found only `oauth.client_secret`, not an
  OAuth access-token or refresh-token reference. An existing grant does not
  prove completed authorization.
- Configured OAuth scopes include `read` and `write`. Future plugin access must
  be constrained by a dedicated gateway/client and explicit read-tool profile;
  do not infer least privilege from the application name or a grant row.
- No profile entry explicitly references this connection or application.
  This count is not a full effective-permissions evaluation: wildcard/other
  selector types and exclusion policies still require native policy readback.

The operator selected **Content Assistant** as the target. A scoped lookup via
Codex's Linear connector resolved exactly one matching project and its team,
and identified that team's exact Todo state. No issue was read or changed.
Identifiers are retained in the local ignored preparation artifact, not in this
public repository. Organization UUID and the relationship to the recipe's
future OAuth principal must still be verified through the managed connection.
Codex's lookup is scope preparation, not proof of native plugin source access.

## Replaying metadata inspection

[recipe-readiness.sql](../../scripts/qualification/recipe-readiness.sql) is a
metadata-only psql preflight. It requires exact `company_id` and `connection_id`
variables, enters `BEGIN TRANSACTION READ ONLY`, sets a five-second statement
limit, and rolls back. It outputs only a fixed allowlist of counts/statuses and
configuration-presence booleans. It neither resolves a secret nor calls Linear.
Use the operator's existing DB-access mechanism; no password belongs in a
command argument, this repository or its receipts.

The script was executed on the recipe with the identified scope and with a
nonmatching company UUID. The latter returned `connection_found: false` and
zero catalog rows. The receipt confirms `transaction_read_only: on`. This SQL
is an operator qualification aid; the plugin never accesses the host database.

## Concrete next operations and owners

| Step | Owner / existing native surface | Required readback |
| --- | --- | --- |
| Complete Linear browser consent for the selected workspace | Operator in Paperclip's existing Linear connection; `POST /api/tools/oauth/:connectionId/start` starts the native browser flow | Correct provider identity/workspace and durable native OAuth grant; no token exported to the plugin |
| Qualify connection/catalog | Native health-check and catalog-refresh operations | Healthy connection, refreshed tool schemas, and verified source-read coverage; flags alone are insufficient |
| Choose supported recipe reachability | Operator's recipe/network configuration | Exact HTTPS gateway origin reachable through existing native `ctx.http` policy; no private-IP policy bypass |
| Prepare the dedicated gateway client | Paperclip native profile, gateway/token and secret binding facilities | Exact company, restrictive read tools/resource scope, finite token expiry, dedicated `gateway_client`, plugin-scoped secret reference |
| Verify through this plugin | Explicit `inspect-gateway` action after separately bounded recipe setup | SDK/native gateway catalog followed by source adapter qualification; no automatic activation |

At this earlier boundary, the OAuth consent and HTTP reachability decisions were independent. The
absence of a reachable gateway does not justify extracting a connector token,
using global fetch to bypass `ctx.http`, changing core policy, publishing a
proxy, or adding GraphQL without a demonstrated connector coverage gap.
The later operator-approved direct transport uses a documented SDK option with
an explicit, strictly local destination; no silent fallback was added.

## Inspected native contracts

Same host source `61b3fd57a695614dc4a37e2303f426a34a9795cf` as Lot 1:

- `server/src/routes/tool-access.ts:973`: start authorization requires native
  connection configuration access; it returns the browser authorization flow.
- `server/src/services/tool-access.ts:14120`: browser consent creates native
  OAuth state; it is not a read-only probe. The default gallery scopes are
  derived from the app definition, so changing a display field is not proof
  that requested provider scopes changed.
- `server/src/routes/tool-access.ts:2132,2166,2186`: health check, catalog refresh
  and catalog readback. The first two perform real provider/native effects and
  were not invoked as speculative checks on an unconfigured grant.
- `packages/db/src/schema/tool_access.ts`: connection, grant, catalog and profile
  metadata used by the read-only preflight; no schema/data changes.

No runtime mutation, credential enrollment, gateway creation, public exposure,
plugin install, ticket import or provider/model run was performed in this
continuation. The exact Linear project is now resolved; the HTTPS recipe URL
and completed native OAuth authorization remain outstanding.
