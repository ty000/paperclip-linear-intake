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
tool. The [recorded input schemas](native-input-schemas.json) preserve the observed
contracts, with connection-specific name prefixes redacted. The catalog JSON digest is
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

Version **0.1.2** includes `probe-source`, absent/disabled unless `sourceProbe` is
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

Probe results always retain `sourceCoverage: unqualified`. The observations below establish some output shapes. They do not establish
terminal-page semantics, complete relation inventory, source organization
binding, independent description completeness or stable source revisions.
The native gateway mapper drops output schemas, so their absence in this
catalog alone is not a proven Linear provider limitation or a reason for a
GraphQL fallback.

## Managed Linear observations and native upgrade

The installed source candidate is **`448f21840d73010a4b3097046edcef01415e7c88`**,
package **0.1.2**. Two bounded probe invocations completed: four calls for scoped
metadata and a two-item page, then six calls including the two enrolled issues.
Both sample UUIDs were checked against the observed project and exact team
before enrollment. No parent, blocker or other ticket was fetched by following
a relation. The probe enrollment was removed afterward; intake stays disabled.
The [final native readback](native-catalog-readback.json) verifies the ready
version, current manifest schema, seven-read profile, eleven-tool catalog and
disabled probe. Worker/manifest digests bind this receipt to installed bytes.

The [redacted source summary](native-source-summary.json) records:

- Managed MCP data is nested in the gateway's `structuredContent`; the actual
  provider JSON is in that inner envelope's text block. Both `isError` values
  were false. A future parser must check both layers.
- Issue `id` and `parentId` are readable identifiers; `uuid` is separate.
- The first two-item page has `hasNextPage:true` and a `cursor`; no terminal
  page or complete descendant traversal was exercised.
- List descriptions have 500 characters. Detail reads returned **5,452** and
  **5,641** characters with a matching prefix. This proves detail retrieval
  exceeds list previews, not independent end-to-end source completeness.
- Relations have `blocks`, `blockedBy`, `relatedTo`, `duplicateOf`; each sample
  had three blockers. Relation IDs are readable identifiers. No external
  blocker state or completeness criterion was inferred.
- Each sample has one open `stateHistory` interval (`endedAt:null`) whose
  `state` includes an ID. This is a candidate for exact Todo validation,
  requiring consistency checks with the current issue state.
- These project/team/issue outputs do not expose the organization ID. That
  observation does not prove every managed connector tool lacks it, nor
  justify adding new authentication. Organization binding remains to qualify.

The native upgrade exposed a packaging defect: the host cache-busts the
manifest entry by mtime, while its transitive `config.js` import remained
cached. The 0.1.1 registry manifest therefore lacked the new config property.
The build now materializes a self-contained data manifest in a fresh process;
0.1.2 native upgrade and config readback succeed without changing/restarting the
host. Both previous package trees were preserved before swapping this plugin's
own active local package. The native upgrade API preserves its plugin UUID.
An earlier install-API attempt was reconciled by readback as no registry/config
change; it was not retried as a new plugin identity. There is no unresolved
effect in the final receipts.

Replay the published redaction from the three **private** observation files:

```bash
node scripts/qualification/summarize-native-source.mjs \
  <catalog.json> <probe.json> <samples.json>
```

Their SHA-256 hashes are in the redacted summary; raw ticket text stays in the
ignored operator artifacts, never in this public repository. Native catalog
replay is available without source reads or provisioning:

```bash
node --import <host-tsx-loader> scripts/qualification/native-catalog-readback.mjs \
  <host-repo> <private-receipt.json>
```

The receipt supplies `gatewayUrl`, `companyId`, `connectionId`, `profileId`,
`gatewayId`, `pluginId` and `secretId` only. The existing native board login is
resolved locally; no token argument or environment variable is required. This
optional native check is separate from portable CI and needs the authorized
recipe plus an unexpired dedicated gateway client.

## Evidence and acceptance

| Criterion | Current result and limit |
| --- | --- |
| L1-A | PASS: independently installable pinned SDK package, disabled schema, real installed 0.1.2 worker |
| L1-B | PARTIAL: input catalog and bounded actual outputs observed; full read coverage still needs qualification |
| L1-C | UNQUALIFIED: no complete family reader; a bounded probe is not a substitute |
| L1-D | PASS for native catalog and bounded managed Linear reads, without a model/agent run or operator token inside the plugin |
| L1-E | Native company/plugin-bound secret resolution PASS during installed discovery; value never returned or logged by the plugin |
| L1-F | PASS for documented transport/catalog limitations; no demonstrated provider gap and no GraphQL fallback |
| L1-G | Local typecheck/build and 102 tests PASS after static-audit corrections; final CI must pass on the published PR candidate, whose build artifact records its SHA and runtime digests |

The first contextual probe review found missing operator authorization on the
native action bridge, which also permits company agents. The guard was corrected
before native source calls. Tests cover absent/system/agent/spoofed actors,
bounded fixed reads, schema drift, upstream errors, credential echo and the
catalog-only action. The real SDK bridge test also rejects actor spoofing before
any config or secret request.

Replay local checks with `npm ci --ignore-scripts --no-audit --no-fund`,
`npm run check`, `npm pack --dry-run --json`. The original
[static gate](native-static-audit.json) recorded Fallow unavailable at the time:
controlled skip, not a passed static audit. A subsequent pinned Fallow 3.23.0
CI job exposed eight introduced complexity findings in PR 2. Targeted extraction
of config validation, catalog pagination, probe validation, operator guards and
qualification-script validation removed those findings without changing audit
thresholds or exclusions. Local validation now passes 102 tests, including
catalog limits, enrollment revocation, actor/company binding and summary
redaction. Two contextual reviews found no actionable regression; a synthetic
before/after comparison covered 204 configurations and 13 gateway/probe paths.

These corrections have not been installed in recipe. The receipts above remain
historical evidence for candidate `448f21840d73010a4b3097046edcef01415e7c88`;
native evidence must be replayed separately against the authorized recipe and
its finite-lived client. Current CI audit/build artifacts identify the exact
source candidate, base, lockfile and runtime digests.

Next: implement and test complete family reads from these observed contracts (pagination, long descriptions,
internal/external typed blockers, child-only selection, historical outcomes,
cycles, revisions and incomplete responses). L1-A through L1-G must all pass
before Lot 2 begins. No acceptance criterion is waived by this continuation.
