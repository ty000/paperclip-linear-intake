# Architecture and ownership

Design baseline: 7 October 2026. The Lot 1 skeleton and gateway catalog probe
are implemented; source retrieval and downstream intake remain proposed. See
[qualification](qualification/LOT1.md) for the source/fixture/runtime distinction.

## Existing capabilities to consume

| Responsibility | Native capability | Qualification still needed |
| --- | --- | --- |
| Detect a status change | Linear `Issue` data-change webhook | Exact team Todo state ID, actor policy and event payload |
| Receive the notification | Paperclip plugin `webhooks.receive` and `handleWebhook` | Raw-body signature verification and installed-host route |
| Read the source | Managed Linear MCP connection through a named Paperclip gateway | Actual tool schemas, read-only rights, full descriptions, descendants, relations and pagination |
| Continue after receipt | Paperclip plugin jobs and durable plugin state/database | Recovery, concurrent attempts and retained uncertainty |
| Represent the work | Paperclip SDK issues, documents and relations | Idempotent identities, full native readback and no early wakeup |
| Notify the receiver | Native plugin events plus durable task/document readiness | Allowlisted source and reconciliation after a lost event |
| Execute the work | Council project mandates, admission and hierarchy | Imported-origin admission and preparation of leaf assignments/scopes |

Linear webhook notifications and its MCP connection serve different purposes.
The webhook triggers retrieval; the managed connection supplies source data.

Paperclip's routine webhook modes in the consulted source do not directly read
Linear's signature header. The plugin webhook route already supplies the raw
body and headers to its worker. Use that route and a native plugin job for the
deterministic intake.

The SDK's `ctx.tools` surface registers agent tools; it does not expose an
arbitrary managed-connector invocation method. The proposed reuse therefore
uses the existing public named MCP gateway with a dedicated client credential
and a profile limited to the required Linear reads. Do not extract or duplicate
the connector's OAuth tokens. Verify transport access and gateway policy during
the first lot; `ctx.http` rejects private-IP targets in the consulted host.

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
  or its receiving contract. Issues 50 and 51 are still open.

These observations identify source contracts only. No usable Linear connection, named gateway credential, public URL, plugin
installation, or launch authority has been verified for this importer. The
operator selected recipe as the first target; a read-only health check confirms
`council-local` is running in authenticated/private mode. Its configured loopback
URL cannot be reached via the consulted host's `ctx.http` private-address policy.
The implementation does not bypass that policy or introduce GraphQL as a workaround.

## Official references

- [Linear webhooks](https://linear.app/developers/webhooks)
- [Linear MCP server](https://linear.app/docs/mcp)
- [Linear GraphQL API](https://linear.app/developers/graphql)
- [Linear parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)
- [Council project mandates, issue 50](https://github.com/ty000/paperclip-council/issues/50)
- [Council hierarchy, issue 51](https://github.com/ty000/paperclip-council/issues/51)
