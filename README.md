# Paperclip Linear Intake

A separate Paperclip plugin that retains an authorized Linear transition to
**Todo**, reads and imports its selected source family, and supplies current
source attestations to an explicitly enabled Council receiver. Council owns
admission, accounting and implementation dispatch.

**Current state:** Lot 1 is qualified against SDK `2026.1005.0`. The disabled
plugin has read two enrolled leaves and one complete native Content Assistant
family: parent plus three children, full descriptions, two internal blocking
edges, eight unresolved external blocker references, and repeated paginated
inventories. See the [criterion ledger and proof](docs/qualification/SOURCE-READER.md).

Version `0.1.4` from candidate `6747347` is installed in recipe. Its eleven
runtime files match the exact-candidate CI build. Temporary source probe/reader
enrollment was removed, the original disabled configuration restored, and the
managed connection verified healthy. No webhook, import or Council admission
is active. **Lot 2 is complete** in source version `0.2.0`: 383 package/worker
tests, 79 isolated PostgreSQL tests, independent review, Fallow and four CI checks
pass. It adds request retention and a scheduled source reader, and is not
installed in recipe. **Lot 3 is complete** in source version `0.3.0`: 594 tests, independent review,
the Fallow gate and four CI checks pass. Native families and uncertainty
recovery are qualified with real core services and an isolated database.
See the [import criterion ledger](docs/qualification/NATIVE-IMPORT.md).
**Lot 4 is complete within isolated qualification:** intake `0.4.0` (`00c3141`)
and Council `0.7.18` (`1b5269c`) demonstrate the installed handoff through settled
N1 `ready_for_review`, before N2, on unchanged host `61b3fd57`. Native workers,
jobs, events, admission and accounting are real; Linear HTTP and CLI model
content/usage are deterministic fixtures. Neither release is installed or
activated in recipe by this lot. Historical receipts remain unchanged. See the
[Lot 4 ledger and limits](docs/qualification/COUNCIL-RECEIVER.md),
[public receipt](docs/qualification/council-receiver-qualification.json) and
[handoff contract](docs/COUNCIL-HANDOFF-V1.md).

Lot 2 uses a signed raw-body webhook, an append-only delivery journal and stable
company/organization/issue identities. It acknowledges valid transitions after
persistence. The scheduled native job performs the initial source retrieval
after the webhook; Lot 4 separately revalidates current source in response to
Council challenges. Explicitly enabled operator actions retain their own bounded
read scope.
See [retention semantics and qualification](docs/qualification/TODO-RETENTION.md).

## Local verification

Requires Node 24.20.0 and npm 11.19.0 (CI pins both).

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm pack --dry-run --json
```

`npm run check` typechecks, builds and runs the SDK harness and actual worker
RPC tests with synthetic host services. Dependencies come from the public npm
registry and the committed lockfile; no adjacent checkout is needed.

The separate `npm run test:postgres` check requires an isolated PostgreSQL 18.1
database via `INTAKE_TEST_DATABASE_URL`, with database and user both `intake_test`.
It recreates only the plugin schema in that disposable database. Never point
this test at recipe. CI provisions its own PostgreSQL service and runs storage
and worker integration tests, including concurrent deliveries and interrupted
writes, in addition to the ordinary package tests.

The independent **Fallow** CI job uses the locked `fallow@3.23.0` and its native
exit status to gate introduced findings, including complexity. It compares a
pull request with its base SHA and a push with its preceding SHA. New branches
and manual runs use the merge-base with the default branch (or the preceding
commit when already at that base). Missing comparison history fails the check.
The `fallow-audit` artifact preserves the native JSON report, candidate/base
SHAs, tool version and input hashes even when the audit fails. Only that audit
directory is uploaded; local qualification evidence stays outside the upload.

To reproduce after `npm run build`:

```bash
npm run audit:static -- --base origin/main
```

The audit disables telemetry and incremental caching. `.fallowrc.json` declares
the Paperclip runtime and manual qualification entry points and excludes local
`artifacts/` copies; it does not relax analysis thresholds. Complexity reports
use estimated coverage unless an actual coverage report is supplied. They are
static evidence, separate from the synthetic tests and native qualification.

The installed 0.1.4 bytes match the CI artifact for `6747347`. The authorized
native REST campaign completed 28 source calls with no failed call. Historical
0.1.2/0.1.3 receipts remain separate from this qualification.

Configuration defaults to disabled retention, disabled native import, disabled
Council handoff and disabled gateway discovery. Enabling retention requires scoped source settings, a webhook
secret reference and explicit operator enrollment. Native import additionally
requires `nativeImportEnabled: true` in the enrolled configuration. An explicitly enabled `inspect-gateway`
action can inspect a configured named gateway catalog using a native secret
reference. The separate `probe-source` action can make only its configured,
bounded Linear reads for an authenticated operator; neither action imports
issues or wakes agents. Startup,
health and config validation perform no HTTP or secret reads.

The `read-source-family` action reads only an enrolled root's subtree, preserves
historical descendants and external blockers, checks all pagination, then repeats
details and inventories to reject observed changes. It returns source evidence
with eligibility flags; it does not grant admission. This action also starts
disabled and uses the same native secret reference and managed gateway.

`gatewayTransport` defaults to `host_http`, using the native `ctx.http` HTTPS
path. Explicit `local_loopback` mode uses a direct Node HTTP connection to the
exact configured `http://127.0.0.1:<port>/mcp/gateways/<id>` endpoint. It preserves
the managed Linear connection and native secret resolution. No redirects,
proxy environment variables, remote hosts or automatic transport fallback are
allowed. See [local transport setup and qualification](docs/qualification/LOCAL-TRANSPORT.md)
for configuration, limits and the remaining native qualification steps.

Version `0.1.4` adds an explicit `gatewayToolCallMode: "native_rest"` option.
Initialization and catalog discovery still authenticate the configured named MCP
gateway. Tool calls then use only `/api/tool-gateway/tools/call` on that same
origin, with the same dedicated credential in the native gateway header. The
default call mode remains `mcp`; failures never switch modes automatically.
`nativeToolTimeoutMs` defaults to 20,000 in REST mode and is bounded to
1,000–30,000 ms. The local client adds a 2,000 ms response allowance for those
calls; the existing 10,000 ms local MCP limit is unchanged. No new capability,
credential or host modification is needed. The native parent-family campaign
qualified this option at 30,000 ms; cleanup restored the original MCP configuration.

## Flow and remaining work

```mermaid
flowchart LR
    L[Linear: ticket enters Todo] --> W[Native Paperclip plugin webhook]
    W --> J[Durable request and native job]
    J --> M[Managed Linear MCP connection]
    M --> T[Native tasks, documents and dependencies]
    T --> C[Council admission and implementation]
```

The integration owns event verification, complete source retrieval, import
identity, recovery, and the handoff. Council owns the project mandate, budget,
execution order, review, and acceptance.

The webhook, durable request and source-reading job are implemented in `0.2.0`.
The `0.3.0` importer prepares blocked, unassigned native families with immutable
source and readiness documents; its isolated qualification is complete.
A `source_observed` result is stored source evidence, and even `prepared` does not
grant Council admission. See the [versioned readiness contract](docs/NATIVE-READINESS-V1.md).

The opt-in Council receiver validates an enabled revisioned project mandate,
prepares explicit contributor assignments and `council-work.ownedPaths`, and
preserves done/cancelled history. Fresh source attestations are required before
preparation and initial admission. Later remote Linear changes do not
automatically revoke an admitted mission; Council retains its pinned native
source, mandate and budget gates.

## First scope

- One explicitly configured Linear workspace/team/project and its exact Todo
  workflow-state ID, mapped to one Paperclip company/project.
- A parent entering Todo selects its remaining descendant work; a child entering
  Todo selects its own subtree and does not authorize its siblings.
- Reuse Paperclip's managed Linear MCP connection, plugin webhooks, jobs,
  secrets, storage, tasks, documents, relations, and events where their contracts
  cover the required behavior.
- Use the official GraphQL API only for source reads that the verified managed
  connector cannot provide.
- Preserve Linear identity, descriptions, hierarchy, blockers, and historical
  results. Duplicate deliveries and restarts must not create a second launch.
- Import and admission run without a model call. Any planning needed from the
  implementation lead belongs to the workflow's existing authorized budget.

Milestone campaigns, Slack, Linear status writeback, merge, deployment, and
Paperclip core changes are outside this first scope.

## Documents

- [Architecture and ownership](docs/ARCHITECTURE.md)
- [Todo import and handoff contract](docs/TODO-INTAKE-CONTRACT.md)
- [Implementation sequence and acceptance checks](docs/IMPLEMENTATION-PLAN.md)
- [Council receiver qualification and limits](docs/qualification/COUNCIL-RECEIVER.md)
- [Repository working instructions](AGENTS.md)

The Council integration is a separate dependency. Its qualified `0.7.18`
receiver accepts this exact imported origin only under an explicit
project mandate with source scope, contributor assignments and write paths.
Readiness, a fresh source observation and Council's existing accounting are
all required. Initial qualification covers a subtree with executable descendants;
roots with no executable descendant and external source blocker references remain
blocked for an explicit operator decision. Operational launch remains disabled.
