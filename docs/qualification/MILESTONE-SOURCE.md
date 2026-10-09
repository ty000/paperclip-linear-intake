# V1 L2 milestone source/import qualification

Date: 9 October 2026. Candidate: package `0.5.0` on branch
`codex/linear-v1-l2`, based on `c9edc6af7c6cdf524e06fb90eb6fcb6c41daaf08`.

## Implemented boundary

The optional campaign path recognizes exactly one fenced
`paperclip-campaign` JSON marker with schema
`linear-milestone-campaign.v1`. Its milestone ID and PRD/TAD reference tuples
are strict. Reference bytes come only from enrolled configuration and must match
their SHA-256 values; the plugin performs no generic URL fetch.

The reader uses the qualified, configured native gateway roles. It requests
project metadata with `includeMilestones`, completely paginates the enrolled
project inventory, selects the exact milestone, then reads all selected details
and descendant inventories. It repeats the complete observation before returning.
Incomplete pages, changed material, scope changes, duplicate identities,
hierarchy/blocker cycles, external blockers and started work fail closed.

The campaign ticket remains outside the milestone and becomes the Paperclip
native root. Milestone roots attach beneath it only in the explicit native
mapping. Every original `source.parentId` remains unchanged. The import is
bounded to 33 total nodes and 99 pre-readiness effects, preserves existing
effect identities/readback, and emits no wake. Only the root source document has
the optional `campaign` extension. The readiness document carries the same
strict campaign value, and the complete import plan digest includes it.

`subject.sourceSha256` remains the digest of the complete original observation.
`campaign.materialSourceSha256` separately covers source content, membership,
parentage, dependencies, milestone data, verified references and native mapping.
Status, timestamps and comments are excluded from this material digest and are
checked through `stateCompatibility`. Preparation and initial admission accept
only explicitly enrolled compatible, non-started states.

The shared contract is implemented in `src/campaign-contract.ts`; the source
adapter is isolated in `src/campaign-source.ts`. The outer historical Todo
schemas, journals and default-disabled behavior remain unchanged.

## Evidence layers

- Package typecheck/build and SDK harness tests cover strict markers, reference
  bytes, bounded pagination, source rereads, material/state separation, deep
  hierarchy mapping, tamper rejection, readiness binding and historical Todo
  regressions.
- Isolated PostgreSQL tests exercise the complete persisted import effects,
  native readback and readiness document for a campaign, with unique effect keys
  and no agent wake.
- The source/readiness contract was compared read-only with Council's V1 receiver
  validator and fixture. Both compute the same material and state digests and
  preserve the same source/native parent distinction.
- The static audit is run against exact base
  `c9edc6af7c6cdf524e06fb90eb6fcb6c41daaf08` with locked `fallow@3.23.0`.

## Open native qualification

The historical catalog proves the input fields used by `get-project`,
`list-issues` and `get-issue`, but the actual milestone response body has not
been observed. The deterministic adapter rejects any other shape. Activation
therefore remains blocked until a read-only native observation qualifies that
shape and supplies its evidence digest in the enrolled configuration.

This lot did not install or activate the plugin, read a live provider, write to
Linear, change Paperclip/Council sources, publish a PR, or run a campaign.
