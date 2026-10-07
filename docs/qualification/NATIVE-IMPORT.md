# Lot 3 — native family preparation

Version `0.3.0`, branch `codex/lot3-native-family-import`, base
`57481d46bc64e2282335c38730f3245a681387d1` (merged Lot 2).
**L3-A through L3-E PASS** on code candidate
`0365009646a5ad79f41eb98111c63e5ff554fcb6`: 425 package/worker tests,
169 PostgreSQL tests, typecheck, build, package inspection, independent review
and four CI checks pass. The [qualification receipt](native-import-qualification.json)
records native and build digests and the [successful CI](https://github.com/ty000/paperclip-linear-intake/actions/runs/37689862718). Operational recipe stays disabled on
`0.1.4`. No real webhook, Linear import, agent or Council admission is activated.

## Acceptance ledger

| ID | Required behavior | Evidence |
| --- | --- | --- |
| L3-A | Parent and three children retain full descriptions and a blocking dependency | Isolated native SDK bridge + real core services + PostgreSQL: four tasks, root description 34,000 characters, three child descriptions 7,600 characters, five immutable documents, internal blocker and full readback |
| L3-B | Child selection stays within its subtree; completed history is preserved | Deterministic plan tests select only child subtree, retain external ancestry in source document; native fixture states blocked/blocked/done/cancelled and exact source bodies |
| L3-C | Incomplete families stay ineligible and never wake implementation agents | Missing inventory, stale source, revoked authority, native tampering, partial effects and failed readiness tests; native fixture counts zero agents, heartbeat runs and wake requests |
| L3-D | Concurrent processing, lost create response and restart create no second family or identity | PostgreSQL CAS engine/storage tests; native lost-response readback under original origin, same-plan completion; new-process replay creates no objects; absent-after-dispatch remains unknown and never rearms |
| L3-E | External blockers and cycles remain explicit; relations are never silently removed | Plan rejects cycles/inconsistent graph, retains unresolved external references; native relation/inverse readback and cycle refusal; importer rejects observed foreign blocker sets |

The plan uses canonical digests and immutable source documents. The journal
records the exact expected effect-key set, not just a count; preparedness
requires all those effects to be associated and observed. Native issue origin
lookup uses two results at offset zero, followed by a full issue read. An
ambiguous match never authorizes creation. A single durable dispatch claim
cannot be leased, reset or replaced.

## Evidence layers and replay

Ordinary `npm run check` uses the published SDK `2026.1005.0`, actual worker RPC
and synthetic transports. `npm run test:postgres` additionally exercises real
PostgreSQL 18.1 with only the plugin schema and synthetic SDK services. CI runs
both independently with no dependency on an adjacent host checkout.

The optional `scripts/qualification/native-import-host.mjs` qualification uses
the real host source at `61b3fd57a695614dc4a37e2303f426a34a9795cf`, its core
migrations/services and the published SDK's capability/invocation-scope bridge.
The consulted host has unrelated work in its lockfile, an untracked Council
plugin and review documents; the imported host service/database/shared/SDK sources are unchanged.
The fixture records source/build/migration/bridge hashes around each run.
Final read-only replays use the candidate source and its 28 compiled modules,
which match CI byte for byte along with both migrations. Earlier effect
executions retain separate code hashes; the final replay does not pretend to
repeat those mutations. The isolated PostgreSQL cluster was stopped after
qualification and its private evidence preserved.

This native layer uses an explicitly identified, disposable local PostgreSQL
database, synthetic source families and no event subscribers. It starts no
server, installed plugin loader, native scheduler, agent or provider. This is
native API/database proof, not an operational installation or real Linear proof.
The real Linear read coverage belongs to the separate Lot 1 receipt.

Replay requires an authorized fresh local database `intake_native_test` owned
by `intake_test`, random loopback port, and a private 0600 receipt at
`artifacts/postgres-lot3/instance.json` matching its URL and exact data directory.
The URL goes only in `INTAKE_NATIVE_TEST_DATABASE_URL`. The script rejects
remote/reserved endpoints, DSN overrides, wrong identities and implicit database
reset before migration. Use the host's TSX loader, the host path and exact SHA,
an unused artifact directory under this repository, and the original identity
receipt for any continuation. The first run migrates a fresh database; a
continuation verifies existing identity and migrations and never reseeds it.
Private raw artifacts and connection details are ignored by Git.

## State and recovery constraints

- `nativeImportEnabled` defaults false and is part of explicit enrollment's
  fingerprint. `enabled:false` suspends processing; changing import authority
  requires explicit re-enrollment and cannot adopt an old request automatically.
- The import job chooses at most one current request and revalidates source
  twice. Pending unprojected deliveries suppress selection and dispatch.
- Plans with unresolved dispatched effects are removed from automatic candidate
  selection so an interrupted request cannot monopolize the queue. Operator
  `reconcile-import` reads original identities; if they exist, the same plan
  can become eligible for the next job. If absent, it remains unresolved.
- Native mutation intent is durable before the unique dispatch. A suspension
  after its CAS claim conservatively retains uncertainty even if no native
  write occurred. It does not release the claim for another attempt.
- The SDK cannot supply an issue-create idempotency key or a base document
  revision. Therefore documents are create-once, exact-readback records, and
  uncertain creates are never retried on absence. Overlapping imports or
  changed immutable payloads block; no replacement identity is fabricated.
- A withdrawal may leave partial native objects and a historical preparing
  plan. New effects and readiness are gated by the current request revision;
  the operation result distinguishes ineligibility from the actual durable state.

## Remaining integration limits

Readiness is the [versioned preparation contract](../NATIVE-READINESS-V1.md),
with `admissionAllowed:false`. It grants no mandate, assignee, write scope,
budget or execution right. Lot 4 needs its own Council write authorization and
qualified receiver. Closed Council issues 50/51 do not cover imported origins,
leaf preparation or preservation of terminal descendants.

The native relation helper is a non-atomic read/union/replace. Plugin workers
serialize their own effect, but foreign writers require coordination. Readback
rejects observed divergence; cross-system reads are not an atomic snapshot.
Any eventual receiver must revalidate current source and native readiness.

No universal claim is made about arbitrary third-party listeners to native
`issue.created` events. This plugin has no wake capability or assignee, emits
no admission event and produced no native wake in the isolated host services.

## Static audit and review

The Fallow 3.23.0 wrapper gate passes. The native CLI exits zero with verdict
`warn`: zero introduced dead-code or complexity findings, three inherited
complexity findings and one non-blocking duplication group. The latter is the
same authenticated-company guard in intake/import actions (fingerprint
`dup:36c41956`), retained after the single bounded remediation pass. No analysis
threshold, suppression, ignore rule or automatic fix was introduced. The new
qualification CLI is declared as a real entry point.

Independent contextual reviews covered SDK/native boundaries, journal identity,
concurrency, authority changes and readiness. Corrections preserve the durable
state when a final CAS is refused, prevent a crashed plan from monopolizing the
queue, reject disappearance of previously observed objects, and reject native
execution reservations. There are no remaining confirmed P1/P2 findings in the
reviewed scope. Foreign relation-writer and receiver boundaries above remain
explicit limits.
