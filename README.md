# Paperclip Linear Intake

A separate Paperclip plugin that will turn an authorized Linear transition to
**Todo** into a durable import of the ticket and its sub-issues, then hand the
prepared work to a governed implementation workflow such as Council.

**Current state:** Lot 1 partial: disabled executable plugin, native gateway
catalog access qualified in local recipe against SDK `2026.1005.0`, and a bounded
operator-only source probe. The complete source-family reader remains unfinished.
Version `0.1.2` is installed in recipe with intake disabled. Its worker resolved
a company-bound native secret, retrieved the dedicated seven-read-tool Linear
catalog and read two explicitly scoped Content Assistant samples. The source
probe was disabled after qualification. Source probes are not complete family
reads. The manifest is packaged as standalone data for reliable native upgrades.
No webhook, import or Council admission is active. Lots 2 and 3 have not started.
See the [current native qualification](docs/qualification/NATIVE-ACCESS.md) and
[original criterion report](docs/qualification/LOT1.md).

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

Default configuration is `{ "enabled": false, "gatewayDiscoveryEnabled": false }`.
This version rejects `enabled: true`. An explicitly enabled `inspect-gateway`
action can inspect a configured named gateway catalog using a native secret
reference. The separate `probe-source` action can make only its configured,
bounded Linear reads for an authenticated operator; neither action imports
issues or wakes agents. Startup,
health and config validation perform no HTTP or secret reads.

`gatewayTransport` defaults to `host_http`, using the native `ctx.http` HTTPS
path. Explicit `local_loopback` mode uses a direct Node HTTP connection to the
exact configured `http://127.0.0.1:<port>/mcp/gateways/<id>` endpoint. It preserves
the managed Linear connection and native secret resolution. No redirects,
proxy environment variables, remote hosts or automatic transport fallback are
allowed. See [local transport setup and qualification](docs/qualification/LOCAL-TRANSPORT.md)
for configuration, limits and the remaining native qualification steps.

## Intended flow (not yet implemented)

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
- [Repository working instructions](AGENTS.md)

The Council integration is a separate dependency. Its current source requires
manual-origin roots; adding a connector does not by itself make imported tasks
admissible. The hierarchy implementation also requires contributor assignments
and explicit write scopes for executable leaves. Both gaps are recorded in the
contract and must be qualified before enabling automatic launch.
