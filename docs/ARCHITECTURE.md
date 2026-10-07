# Architecture and ownership

Updated 7 October 2026. Lot 1 source reads are qualified natively; Lot 2 durable
retention is qualified in isolation. Lot 3 native import is being qualified in
version `0.3.0`. Recipe remains disabled on `0.1.4`; Council admission is separate.
See the [implementation ledger](IMPLEMENTATION-PLAN.md) and
[versioned readiness contract](NATIVE-READINESS-V1.md).

## Existing capabilities to consume

| Responsibility | Native capability | Observed boundary |
| --- | --- | --- |
| Receive a status transition | Plugin raw-body webhook | Signature/scope/actor checks and durable acknowledgement qualified synthetically; no operational webhook |
| Read the source | Managed Linear connection and scoped named gateway | Complete native source family qualified in Lot 1 |
| Continue after receipt | Native jobs and plugin database | Durable retention, CAS concurrency and restart qualified in isolated PostgreSQL |
| Represent the work | SDK issues, documents and relations | Lot 3 isolated core-service qualification; all active tasks blocked and unassigned |
| Prepare the receiver | Immutable native readiness document and effect journal | Readiness v1; no admission event or agent wake |
| Execute the work | Council mandates, admission and hierarchy | Separate Lot 4: imported origin, contributor scopes and terminal history |


Linear webhook notifications and its MCP connection serve different purposes.
The webhook triggers retrieval; the managed connection supplies source data.

Paperclip's routine webhook modes in the consulted source do not directly read
Linear's signature header. The plugin webhook route already supplies the raw
body and headers to its worker. Use that route and a native plugin job for the
deterministic intake.

The SDK's `ctx.tools` surface registers agent tools; it does not expose an
arbitrary managed-connector invocation method. The implementation therefore
uses the existing public named MCP gateway with a dedicated client credential
and a profile limited to the required Linear reads. Do not extract or duplicate
the connector's OAuth tokens. Verify transport access and gateway policy during
the first lot; `ctx.http` rejects private-IP targets in the consulted host.

The SDK also explicitly supports direct Node HTTP clients. Following the
operator's local-recipe decision, an opt-in `local_loopback` transport connects
only to the exact configured IPv4 loopback gateway using `node:http`. Config
and secret resolution still use the SDK; the named gateway still owns client
authentication, profiles and the managed Linear OAuth connection. This changes
only the plugin's HTTP transport. It does not relax the host's network policy.
The default `host_http` path remains available for a reachable HTTPS gateway on
the future VPS. Local calls have bounded bodies/deadlines and redacted plugin
logs, but do not receive `ctx.http` tracing. See [transport qualification](qualification/LOCAL-TRANSPORT.md).

If the managed tool catalog lacks a required source read, document that exact
gap before adding a bounded GraphQL reader using an explicitly configured
secret reference. Do not replace a supported connector without evidence.

## Repository boundaries

| Surface | Owner | Permitted first-lot effects |
| --- | --- | --- |
| `ty000/paperclip-linear-intake` | Event intake and native import | Source, tests and design documents in this repository |
| Paperclip host/SDK | Plugin runtime and native objects | Read-only contract inspection; isolated qualification later |
| Council | Mandates, admission, execution, review and acceptance | Read-only inspection; any adapter change requires its own isolated lot |
| Linear | Source tickets, hierarchy and workflow states | Read-only qualification first; webhook activation later |

The importer must not modify Council database tables, impersonate its owner,
grant publication rights, reserve a second implementation budget, or implement
an alternative execution scheduler.

## Consulted source baselines

- Paperclip: `/home/davy-lp/workspace/paperclip`, branch
  `codex/council-feasibility`, HEAD
  `61b3fd57a695614dc4a37e2303f426a34a9795cf`. The checkout has unrelated dirty
  files and is read-only for this project. Cited paths: SDK
  `packages/plugins/sdk/src/types.ts`, `server/src/routes/plugins.ts`,
  `server/src/routes/tool-gateway.ts`,
  `packages/shared/src/validators/tool-access.ts`, and `docs/api/routines.md`.
- Council project-mandate baseline: branch `codex/council-project-mandates`,
  HEAD `0224d5f2442e69cf7f5c82a2c9206b71fe61781f`, version 0.7.12.
- Council hierarchy source rechecked at `1c96890f6147cbf517d2b3f54209f6abc2b8b880`,
  branch `codex/council-variable-hierarchy`. Issue 51 now reports qualification
  and recipe installation of 0.7.13; that report does not qualify this importer
  or its receiving contract. Issues 50 and 51 are now closed; their manual-origin qualification does not
  qualify imported origins, contributor preparation or terminal-history adoption.

The source baselines above remain read-only references. Native recipe discovery
now succeeds from the installed disabled plugin through a dedicated eight-tool
read profile, gateway client and company-bound encrypted secret. See
[native qualification](qualification/NATIVE-ACCESS.md). The source reader has qualified a complete parent family, including full
descriptions, pagination and blockers. These observations do not grant Council
admission. See the [source ledger](qualification/SOURCE-READER.md).
No GraphQL fallback or host/SDK modification is introduced.

## Official references

- [Linear webhooks](https://linear.app/developers/webhooks)
- [Linear MCP server](https://linear.app/docs/mcp)
- [Linear GraphQL API](https://linear.app/developers/graphql)
- [Linear parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)
- [Council project mandates, issue 50](https://github.com/ty000/paperclip-council/issues/50)
- [Council hierarchy, issue 51](https://github.com/ty000/paperclip-council/issues/51)
