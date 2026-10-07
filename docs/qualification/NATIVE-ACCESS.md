# Native recipe access — 7 October 2026

**L1 remains PARTIAL.** Native catalog discovery and secret delivery now pass.
The complete source reader (L1-C), full output coverage (part of L1-B), and
therefore Lots 2/3 remain unqualified. A catalog is not a source-family snapshot.

## Baseline and observed runtime

PR [1](https://github.com/ty000/paperclip-linear-intake/pull/1) was merged after
two contextual reviews, the manifest host-version correction, 68 passing tests
and successful exact-candidate CI. Merge commit:
`f418c1e8ae2961844d498264957642596d23c98a`.
This continuation starts from that commit on `codex/lot1-native-qualification`
in a separate durable worktree. No Paperclip/SDK/Council source was changed.

At 15:52 UTC, the installed **0.1.0** worker returned `catalog_observed` using
the real named gateway on loopback, SDK config/secret RPC and Paperclip's native
encrypted secret provider. The catalog contains seven configured Linear reads
and four built-in resource/prompt wrappers. It does not contain a Linear write
tool. The catalog JSON digest is
`e51b76295ba8ac5f60f71294807f2390a9036e685667cd5ab27e4555079ca522`.

The setup used one new profile with default deny and seven explicit catalog
entries, one gateway with `gateway_only` profile selection, one dedicated
`gateway_client`, one native secret and one disabled plugin installation. The
pre-existing broader profile was preserved. No default company/project/agent
binding was added. The qualification client expires on **8 October 2026 at
15:52:39 UTC**; a historical successful observation is not a promise of access
after expiry. Its only actions are `tools/list` and `tools/call` subject to the
gateway's read profile. Operator authentication was used only by the setup
driver, never passed to the plugin; the Linear OAuth credential stays managed.

## Bounded source probe

Version **0.1.1** adds `probe-source`, absent/disabled unless `sourceProbe` is
explicitly configured. It requires an authenticated `user` actor from the real
SDK action context, with a user ID and matching company. Caller-supplied actor,
scope, query, tool or issue fields cannot widen the operation.

Configuration enrolls exact `teamId` and `projectId` UUIDs; zero to two explicit
`sampleIssueIds`; and five role pins (`getProject`, `getTeam`, `listStatuses`,
`listIssues`, `getIssue`), each with the observed gateway tool name and SHA-256
of `JSON.stringify(inputSchema)`. A missing or changed pin stops all source
calls. Obtain these from a fresh native `inspect-gateway`, never guessed names.

The action makes four fixed read calls: project, team, workflow states, and one
two-item issue page filtered by the configured project/team with archives
included. It then reads only the explicitly enrolled sample UUIDs, requesting
`relations` and `stateHistory` in `fields`. It does not paginate, follow links,
import, save source data, activate intake, or wake an agent. Raw observations
are returned only to the operator and must not be committed to this public
repository. Transport limits and secret-echo rejection still apply.

The operator's authorized source is the **Content Assistant project**. Linear's
schema says a UUID team filter also includes descendant teams, irrespective of
`includeSubTeams:false`. The probe makes no exact-team claim. A future eligible
family reader must validate exact returned `teamId` and project membership;
sample UUID enrollment also needs an operator readback of their membership.

Probe results always retain `sourceCoverage: unqualified`. Without actual
output observations, do not infer UUID versus issue identifier semantics,
cursor/terminal-page shapes, relation direction/completeness, organization ID,
exact workflow-state ID, complete descriptions or stable source revisions.
The native gateway mapper drops output schemas, so their absence in this
catalog alone is not a proven Linear provider limitation or a reason for a
GraphQL fallback.

## Evidence and acceptance

| Criterion | Current result and limit |
| --- | --- |
| L1-A | PASS: independently installable pinned SDK package, disabled schema, real installed 0.1.0 worker |
| L1-B | PARTIAL: native input catalog observed; provider output contracts and full coverage still need qualification |
| L1-C | UNQUALIFIED: no complete family reader; a bounded probe is not a substitute |
| L1-D | Native catalog path PASS without model/agent run or operator token inside the plugin; actual provider reads pending |
| L1-E | Native company/plugin-bound secret resolution PASS during installed discovery; value never returned or logged by the plugin |
| L1-F | PASS for documented transport/catalog limitations; no demonstrated provider gap and no GraphQL fallback |
| L1-G | Candidate checks and exact-head CI are required for this continuation; build evidence remains separate from native receipts |

The first contextual probe review found missing operator authorization on the
native action bridge, which also permits company agents. The guard was corrected
before native source calls. Tests cover absent/system/agent/spoofed actors,
bounded fixed reads, schema drift, upstream errors, credential echo and the
catalog-only action. The real SDK bridge test also rejects actor spoofing before
any config or secret request.

Replay local checks with `npm ci --ignore-scripts --no-audit --no-fund`,
`npm run check`, `npm pack --dry-run --json`. Static Fallow remains unavailable:
controlled skip, not a passed static audit. Native evidence must be replayed
separately against the authorized recipe and its finite-lived client.

Next: establish provider output contracts through the bounded probe, then
implement and test complete family reads (pagination, long descriptions,
internal/external typed blockers, child-only selection, historical outcomes,
cycles, revisions and incomplete responses). L1-A through L1-G must all pass
before Lot 2 begins. No acceptance criterion is waived by this continuation.
