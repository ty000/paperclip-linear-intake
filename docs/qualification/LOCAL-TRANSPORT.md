# Local recipe transport — 7 October 2026

**Historical report.** The later [native qualification](NATIVE-ACCESS.md)
supersedes native gateway/installation blockers below. Complete source-family
coverage remains unqualified; the original receipts remain unchanged.


**Result: implemented and locally tested; native recipe access still unqualified.**
This is a bounded continuation of Lot 1. It does not implement a Linear reader,
install the plugin, configure a live gateway/client, activate intake or start
Lots 2/3. The operator approved a local transport while VPS deployment is deferred.

## Ownership and evidence baseline

- Plugin: `codex/lot1-source-access`, clean preflight at
  `021b21f08fa9c3f7942024f95e8c559b7679cb06`; Git base gate passed against its
  fetched upstream. Remote main remains `7b5983db12132427f5d1666d3f85147792acd39d`.
- Paperclip host/SDK sources remain read-only at consulted baseline
  `61b3fd57a695614dc4a37e2303f426a34a9795cf`. Council is unchanged/out of scope.
- The locked published SDK `2026.1005.0`, `dist/types.d.ts` `PluginHttpClient`,
  explicitly permits direct Node HTTP clients. Its `ctx.http` wrapper supplies
  host-managed tracing/audit; the inspected host implementation rejects private
  destinations. This is a transport limitation, not a Linear read-coverage gap.
- Source reference: [SDK HTTP contract at the pinned host baseline](https://github.com/paperclipai/paperclip/blob/61b3fd57a695614dc4a37e2303f426a34a9795cf/packages/plugins/sdk/src/types.ts).
- Candidate identity is recorded by the existing exact-PR-head CI job in the
  `lot1-build-evidence` artifact. A synthetic HTTP test is not native gateway
  policy, real secret-provider binding or provider qualification.

## Configuration

The default transport remains `host_http`: HTTPS named gateway through
`ctx.http`, with the existing host DNS/IP policy. There is no automatic fallback.

For a separately provisioned local recipe gateway, explicitly select
`local_loopback`. Example below uses a **placeholder gateway and secret ID**;
replace both with the operator-provisioned native identities. Never paste a
credential value into configuration.

```json
{
  "enabled": false,
  "gatewayDiscoveryEnabled": true,
  "gatewayTransport": "local_loopback",
  "gatewayUrl": "http://127.0.0.1:3210/mcp/gateways/gw_REPLACE",
  "localGatewayTimeoutMs": 5000,
  "gatewayTokenRef": {
    "type": "secret_ref",
    "secretId": "20000000-0000-4000-8000-000000000002"
  }
}
```

Config must be bound to the intended company and secret through the native
plugin facilities. `inspect-gateway` is an explicit action; setup, health and
config validation have no HTTP or secret-read effects. `enabled: true` remains
invalid. The config is re-read and its token resolved for each action, with no
persistent credential cache.

## Local transport boundary

- Only canonical `http://127.0.0.1:<port>/mcp/gateways/<id>` is accepted. Port is
  explicitly configured, 1–65535; gateway ID contains ASCII letters, digits,
  hyphens and underscores. The raw string is checked before normalization.
- No DNS/localhost aliases, IPv6, other loopback/private/public IPs, credentials
  in the URL, query/fragment, traversal, escaped paths, whitespace or redirects.
- `node:http` sends POST to the configured port/path with an unpooled direct
  agent (`agent: false`). It does not use the process's proxy environment.
  Tokens stay on the configured local connection; non-2xx responses stop the
  operation, without retries, fallback or forwarding credentials.
- Deadline covers connecting, headers and the complete body: 5 seconds per
  request by default, configurable from 100 ms to 10 seconds. At most 12 HTTP
  requests per catalog inspection (initialize, notification, ten pages).
- Response bodies are bounded while streaming to 2 MiB, including notification
  replies; excessive Content-Length is rejected before reading. Timeout,
  oversize and transport errors destroy the request/connection. Responses are
  not automatically decompressed. Unsupported content/protocol is rejected.
- Local transport logs contain only transport, fixed outcome, numeric HTTP
  status when available, byte count and elapsed milliseconds. They do not
  contain gateway URLs, headers, tokens, bodies or upstream exception text.
  These logs replace only the missing transport diagnostics; they are not a
  claim of identical `ctx.http` auditing. Gateway authorization still applies.
- Gateway discovery retains its schema, protocol, pagination, duplicate and
  secret-echo checks. It does not expose a generic HTTP proxy or call tools.

Both worker and gateway must share the loopback network namespace. The current
local process recipe is the intended topology; a separately networked container
requires its own qualification. For the VPS, select `host_http`, configure its
reachable HTTPS gateway, remove `localGatewayTimeoutMs`, and repeat native
qualification. This is configuration plus verification, not proof of deployment.

## Checks and remaining qualification

Replay: `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check`,
`npm pack --dry-run --json`, then `node scripts/record-check.mjs` on the candidate.

Local verification on Node `24.20.0` / npm `11.19.0`: clean lockfile install,
typecheck, build and **68/68 tests passed**. Package inspection includes the
compiled transport and excludes test fixtures/local artifacts. Whitespace and
local Markdown links pass. Local code review covered destination validation,
credential routing, socket cleanup and evidence boundaries. This is local
review, not an independent review or installed-host qualification.

Subsequent contextual subagent review found no transport defect, but identified
one existing installation blocker: `minimumHostVersion` had been inferred from
the SDK release. The source host bootstrap can pass `0.0.0` to the native loader,
which rejects that floor before installation. The optional manifest field was
removed; SDK version, API version and capabilities remain explicit. This fixes
that preinstallation check, not the outstanding native integration evidence.
The read-only [native loader preflight](../../scripts/qualification/host-loader-preflight.mjs)
reproduces the old rejection and lets the corrected manifest reach a fake DB
sentinel after validation, with no persistence or worker launch. To replay after
building this package, run `node --import <host-tsx-loader> scripts/qualification/host-loader-preflight.mjs <host-repo>`
using the existing host's TypeScript loader. This optional probe is not a CI
dependency and never installs or starts the host.

The transport reviewer also replayed 66 focused tests and synthetic socket
probes for HTTP 101/204, duplicate Content-Length, protocol mismatch and early
closure, with no confirmed defect. The SDK reviewer replayed the complete 68
tests and package checks. Both reviews approve merging the bounded skeleton /
transport scope after the manifest correction and candidate CI; neither closes
native L1 qualification.

| Evidence | Result / limit |
| --- | --- |
| Strict config + actual host-dialect AJV | Default HTTPS mode and opt-in enum/timeout shape; runtime validation checks the exact destination before secrets or network |
| SDK harness + synthetic gateway on real sockets | Scoped secret call, real HTTP requests, disabled behavior and config re-read; not the operational secret provider |
| Adversarial local transport tests | Alternate URL spellings/targets, redirects, oversize length/chunks, truncated/invalid/SSE responses, reflected token, cursor loop and stalled headers/body/notification |
| Built SDK worker process + synthetic host RPC + real loopback | Native config/secret serialization; local mode makes no `http.fetch` host call; proxy-environment sentinel receives no credential/request; logs redacted |
| Existing HTTPS harness and worker bridge | Existing host path retained; no automatic local fallback |
| Static diff gate | See [gate receipt](local-transport-static-audit.json); missing Fallow is a controlled skip, not a passed static audit |

The operator completed OAuth; later read-only host metadata showed an active,
healthy Linear connection and 68 catalog tools. The subsequently created intake
profile selected the whole application and had no bindings or gateways at the
last readback. The operator accepted leaving it temporarily for preparation;
this does not satisfy the dedicated read-only access criterion.

Next native qualification still needs a dedicated gateway/client, a restricted
read profile and correctly bound secret; an installed disabled plugin; actual
catalog discovery; and complete scoped Linear source reads. No real gateway,
Linear ticket, model run or import is exercised by these tests. Webhook receipt
is separate: signed synthetic events can test the future local receiver, while
real Linear webhook delivery will need a reachable ingress at activation.
