# Lot 1 qualification — 7 October 2026

**Continuation:** [Local transport qualification](LOCAL-TRANSPORT.md) records the
subsequent opt-in loopback implementation and its tests. It supersedes this
report's HTTPS-only next-step requirement and initial test count. The original
candidate/CI receipts below remain historical evidence. Lot 1 is still partial;
native gateway credentials and complete Linear reads remain unqualified.

**Verdict: PARTIAL / BLOCKED. Lots 2 and 3 NOT STARTED.** The executable
skeleton is reviewable; complete Linear source retrieval is not implemented or
qualified. Target confirmed by the operator: recipe first, with council-local
available for tests. No runtime mutation was performed.

## Identity and scope

- Repository: `ty000/paperclip-linear-intake`, branch `codex/lot1-source-access`.
- Base, local main and remote main at preflight:
  `7b5983db12132427f5d1666d3f85147792acd39d`; clean; git-safety **pass**.
- Durable worktree: `/home/davy-lp/workspace/paperclip-linear-intake-lot1`.
- Candidate identity: the immutable commit checked by the **Package checks**
  job, recorded as `candidate` in its `lot1-build-evidence` Actions artifact.
  That job explicitly checks out the PR head SHA, not GitHub's merge commit.
- Write allowlist: package, source, tests, build/CI, evidence and necessary docs
  in this repository only. Other checkouts are read-only.
- `migration_prewrite: not-applicable`: new plugin, no existing-state migration.
- No install, activation, connection/token/webhook creation, source-ticket read,
  import, provider run, external message, Council mutation, merge or npm publish.

## Acceptance matrix

| ID | Result | Evidence and precise limit |
| --- | --- | --- |
| L1-A | PASS — package/source/SDK | Manifest passes the published native validator; TypeScript compiles against exact SDK `2026.1005.0`; built worker initializes through its real SDK RPC host. Empty config disables all discovery; intake `enabled: true` is rejected. No installed-host compatibility claim. |
| L1-B | BLOCKED | Native gateway protocol and SDK APIs are source-identified below. A catalog inspector is executable, but no authorized Paperclip Linear tool catalog has been retrieved. Synthetic `fixture_read` is explicitly not a Linear tool. |
| L1-C | BLOCKED | Full descriptions, descendants, typed blockers, states and revisions need verified tool inputs/outputs and pagination semantics. No Linear adapter or family reader is fabricated. |
| L1-D | PARTIAL / BLOCKED natively | SDK harness and subprocess bridge perform config/secret/HTTP calls without models, operator tokens or issue APIs. Dedicated gateway credential and a reachable gateway remain unqualified. |
| L1-E | PARTIAL / BLOCKED natively | Actual SDK serializes `ctx.secrets.resolve(secret_ref, {companyId, configPath})`. Fixtures verify scope, missing/refused references, and no returned/logged credential. Native secret-provider binding and delivery have not been exercised. |
| L1-F | PASS — limitations recorded | JSON gateway protocol, private-address restriction, missing catalog and proof limits documented. No connector coverage gap is established; no GraphQL fallback added. |
| L1-G | PASS — local and published CI | Node 24.20.0, npm 11.19.0, TypeScript 7.0.2; typecheck, build and 43 tests pass. Lockfile-only install and package contents checked. CI runs the same checks from a clean checkout and records its exact candidate. The published implementation candidate passed both push and PR workflows; exact identities and artifact readback follow below. |

The overall boundary remains blocked even if CI is green. No L1 pass is promoted
to native gateway/real-connection evidence. No Lot 2/3 acceptance was weakened.

## Published candidate and CI readback

Implementation candidate: `58ae4c5a2bdfd11d6fb6bd8ee0074c53b98e2430`,
[draft PR 1](https://github.com/ty000/paperclip-linear-intake/pull/1).
Both **Bootstrap checks** and **Package checks** passed on this SHA in the
[push workflow](https://github.com/ty000/paperclip-linear-intake/actions/runs/37635169786)
and [PR workflow](https://github.com/ty000/paperclip-linear-intake/actions/runs/37635259839).
The downloaded [build evidence](lot1-build-evidence-58ae4c5.json) confirms the
candidate, SDK, Node/npm versions and lock digest. The subsequent evidence-only
commit does not change implementation; its own exact-head CI must also pass
before final handoff. Latest candidate identity remains available in its Actions
artifact without a self-referential commit hash in this report.

## SDK distribution and executed evidence

`npm view @paperclipai/plugin-sdk@1.0.0` returned E404. The local monorepo
manifest's `1.0.0` and `workspace:*` shared dependency cannot establish an
independently installable package. The published stable package actually used:

- `@paperclipai/plugin-sdk@2026.1005.0` (locked), integrity
  `sha512-Ii54ukCFMujaRVGrRV/+RaudPmXka0FnSFF4Q8mTv8Gktb92okbPTtctf3zTlUNe908FG1tKoM90UGF2YwfVWA==`.
- Published dependency `@paperclipai/shared@2026.1005.0`, with built `dist`
  exports; its real manifest validator is used by tests. It brings `three`;
  React is an optional peer and is not needed by this worker.
- Published `zod` range resolves to `4.6.5` in the lockfile. No SDK source/types
  are copied, replaced, patched or linked from the neighboring monorepo.
- The SDK release is pinned independently of the host. The initial manifest
  incorrectly reused that release as `minimumHostVersion`; contextual review
  found that the native loader can receive host version `0.0.0` on the source
  recipe and reject installation. The unsupported optional floor was removed.
  API version and capabilities remain declared; host compatibility still needs
  native qualification and is not inferred from the SDK package version.

Replay from a clean checkout:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm pack --dry-run --json
node scripts/record-check.mjs
```

`record-check` records identity/versions after these checks; its output alone is
not a passing test verdict. Actions stores it only after successful checks.

| Evidence | Layer | What it proves |
| --- | --- | --- |
| `test/config-schema.test.mjs` | Host-equivalent Ajv 8.20.0 + formats 3.0.1 | Draft-7 input schema compiles, accepts absent defaults and rejects activation/plain credentials |
| `test/gateway.test.mjs` | Published SDK harness + synthetic HTTP/secrets | Strict disabled config, scoped references, catalog pagination/bounds, malformed responses, access failures, redaction and no partial catalog return |
| `test/worker-rpc.test.mjs` | Built worker + real SDK process/RPC | Initialize, validation, health, shutdown; no unsolicited host calls |
| `test/worker-bridge.test.mjs` | Real SDK wire bridge + synthetic host services | Actual serialization/reconstruction of company config, bound secret reference and HTTP responses; no model or import calls |
| `lot1-build-evidence` Actions artifact | Clean package CI | Exact candidate, lock digest, tool versions and check commands |
| [Static gate JSON](lot1-static-audit.json) | Local gate wrapper | **SKIPPED**, Fallow unavailable; not a successful static audit |

Local review inspected source, tests, manifest capabilities, lockfile,
package contents and diff. Static-analysis residual risk remains. Fallow was
not installed; no cloud, telemetry, coverage upload or autofix was used.

## Source contracts and repository ownership

Paperclip source baseline: branch `codex/council-feasibility`,
`61b3fd57a695614dc4a37e2303f426a34a9795cf`. Its unrelated dirty lockfile and
untracked work were preserved. Referenced tracked source files were inspected
without changing the host or SDK:

| Native surface | Source path and observed contract |
| --- | --- |
| SDK tools | `packages/plugins/sdk/src/types.ts:1002`: `ctx.tools.register`; no generic connector caller |
| SDK HTTP | Same file, line 641: `ctx.http.fetch`; published worker serializes only method/headers/body |
| SDK secrets | Same file, line 667: shared `secret_ref` object, scoped resolve with company/configPath |
| Secret binding checks | `server/src/services/plugin-secrets-handler.ts`: company/plugin binding and configPath validation; values resolved at call time |
| Public named gateway | `server/src/routes/tool-gateway.ts:237`: POST `/mcp/gateways/:gatewayPublicId`; Bearer auth; initialize protocol `2025-03-26`, notifications, tools/list, tools/call |
| Catalog | Same route, line 100: live tool names and `parametersSchema` mapped to `inputSchema`; no complete Linear output schema asserted |
| Dedicated identity | `server/src/services/tool-gateway.ts:8679`: `gateway_client`, scoped profile and token allowedActions; do not use an operator token or connector OAuth token |
| Gateway policy | `packages/shared/src/validators/tool-access.ts:708`: named gateway requires a profile; profile must restrict tools to authorized reads |
| Host network policy | `server/src/services/plugin-host-services.ts:137,1580`: DNS/IP validation, private-address rejection and pinned HTTP connection; no redirect following |

These SDK signatures were also verified in the installed npm declaration and
JavaScript files, rather than assuming the monorepo and release were identical.
The inspector supports only the verified JSON gateway protocol. It rejects SSE,
protocol mismatch, redirects, incomplete schemas, repeated cursors and limits
of 10 pages / 1,000 catalog entries / 2 MiB per response. These are **catalog**
bounds, not source-family limits. The host buffers responses before the worker
receives them; the plugin's size check does not bound host memory. The SDK drops
`RequestInit.redirect`; redirect protection relies on the inspected host's
non-following HTTP implementation and rejecting non-2xx responses.

Council ownership remains mandate/admission/budget/assignments/write scopes and
execution. The main checkout is documentary branch `codex/product-prd-roadmap`
at `365809efdf190010f818a25b938bad59ebd4f33c`, with unrelated untracked reviews.
Relevant source references were therefore read from existing worktrees:

- Project mandates `0224d5f2442e69cf7f5c82a2c9206b71fe61781f`,
  `src/project-task-intake.ts:53`: manual-origin roots only.
- Hierarchy `1c96890f6147cbf517d2b3f54209f6abc2b8b880`,
  `src/project-task-intake.ts:56,101`: manual provenance persists; assignments
  and ownedPaths remain explicit receiving requirements.
- [Council issue 50](https://github.com/ty000/paperclip-council/issues/50) and
  [issue 51](https://github.com/ty000/paperclip-council/issues/51) were read on
  7 October; both remain OPEN. Issue 51 reports 0.7.13 recipe qualification;
  this is a receiving-project report, not this plugin's integration proof.

## Recipe access and missing evidence

Read-only projection of the council-local configuration found an authenticated,
private host bound to `127.0.0.1:3210`, without a configured public URL. A GET to
`/api/health` returned `status: ok`, `deploymentMode: authenticated`,
`deploymentExposure: private`. No credentials, company objects, tickets or
operational state were queried. A shell health GET is not evidence of plugin
`ctx.http` access. The host policy above rejects the loopback gateway path.

No authorized public gateway URL, dedicated gateway-client secret binding or
Linear organization/team/project scope was established. Their absence proves
neither a missing Linear tool nor an OAuth limitation. The Codex Linear connector
is a different execution path and was not used to claim Paperclip coverage.

The official [Linear MCP documentation](https://linear.app/docs/mcp),
[GraphQL guide](https://linear.app/developers/graphql) and
[webhook reference](https://linear.app/developers/webhooks) were consulted.
They do not supply this recipe connection's live tool catalog. A GraphQL
fallback has no demonstrated coverage gap to justify it at this boundary.

Required family cases remain **NOT RUN / BLOCKED**, rather than substituted with
made-up Linear replies: multi-page descendants; complete long issue description;
internal/external typed blockers; child-only subtree; completed/canceled history;
incomplete family/access failure/non-conclusive issue pagination. Only analogous
**catalog** transport failures and default/secret config boundaries were tested.

## Continuation: recipe metadata inspected

The [recipe access continuation](RECIPE-ACCESS.md) identifies the actual
draft/disabled Linear connection and records a replayable read-only metadata
receipt. The operator selected Content Assistant; project/team/Todo identifiers
were resolved via Codex only. Native OAuth and gateway reachability remain
blocking prerequisites. No Lot 1 verdict changed.

## Next bounded step

Establish an authorized recipe gateway using either the default host HTTP
transport or the explicitly configured [local transport](LOCAL-TRANSPORT.md),
with a dedicated read-only client profile and native secret reference,
plus exact Linear read scope. Provisioning/install remains a separate step;
the local transport does not require public exposure. Then inspect the actual
tools/list schemas through the plugin, verify output
coverage with scoped source reads, and implement/qualify the corresponding
reader. Add GraphQL only if those schemas demonstrate a precise missing read.
Re-run all L1 checks on that candidate before considering Lot 2. Lot 4 and the
Council adapter remain outside this repository's write authorization.
