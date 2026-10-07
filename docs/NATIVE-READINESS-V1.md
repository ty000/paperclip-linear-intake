# Native readiness and Council handoff v1

Lot 3 produces `linear-native-readiness.v1` in the root issue's immutable
`linear-intake-readiness-v1` document. It records preparation only. It always
sets `admissionAllowed: false`, `implementationStarted: false`,
`receivingContract: "unqualified"` and
`requiresCurrentSourceAndMandateRevalidation: true`.

## Bound identities and evidence

No Council mandate identity is claimed by this preparation document. The Lot 4
receiver binds its current mandate and admission receipt to this revision in
its own challenge and journals. That evidence does not rewrite immutable
readiness flags, hashes or historical receipts.

The body binds `companyId`, stable `intakeId`, `activationId`,
`configurationFingerprint`, `requestVersion`, `planSha256`, `sourceSha256`,
`targetProjectId`, `originKind`, `sourceRootId` and `nativeRootId`.
`correspondence` contains every selected source/native ID pair, original plugin
origin, source revision and prepared native status. `effects` records the
immutable intent digest and observed result/digest for each issue, source
document and consolidated blocker set. Document results include the native
revision ID and number. `externalBlockers` preserves unresolved references;
those references authorize no extra imports.

Every node has an immutable `linear-source-v1` document containing its complete
source detail, source snapshot digest and intake provenance. Source `completedAt`,
`canceledAt`, archival state and revisions remain source history. Native done or
cancelled timestamps are import timestamps, not evidence of execution here.

The plugin database retains the plan, effect intents and results. The plan's
final readiness receipt includes the readiness document's own ID, revision,
content digest and native root. The immutable document cannot include its own
revision in its body. A receiver must read the native document and its revision,
not trust an event or a previously cached payload.

## Preparation and recovery

The separate `prepare-import` native job processes at most one retained,
`source_observed` request per invocation. `enabled` and the additional
`nativeImportEnabled` setting must both be true, under the explicitly enrolled
configuration fingerprint. There is no historical Todo sweep. Startup, health
and validation are inert. Neither job wakes agents or emits an admission event.

Before import and again before readiness, the importer reads the selected source
family and requires the retained source digest. It validates the native target
project and reads back full issues, documents and blocker sets. Active source
work becomes blocked, unassigned native tasks. Completed/canceled descendants
remain done/cancelled and unassigned. A selected child's unselected ancestry is
context in the source document, never an additional imported parent or sibling.

A company/organization/issue effect identity is unique in the plugin journal.
Each native write has durable intent and a compare-and-set claim before its
single dispatch. The SDK exposes no issue-create idempotency key and the native
origin index is not unique. Therefore absence after an uncertain dispatch does
not permit another create. A restarted worker reconciles the original origin,
full payload and document/relation identity. It never allocates a replacement
key. Conflicting payloads, overlapping families or ambiguous native origin
matches block rather than rewrite existing objects.

`inspect-import` reports plan/effect states and digests without source bodies.
An authenticated company operator can run `reconcile-import` on an intake.
Reconciliation only reads native objects and journals their observed results;
it never dispatches or rearms an effect. An outcome-unknown plan can resume only
when all dispatched/uncertain effects are observed and its authority is still
current. An intended effect never dispatched may then receive its first dispatch
from the normal job. Missing or mismatched effects remain unresolved. Plans
with a dispatched/uncertain effect are excluded from automatic selection until
operator readback resolves it; a crashed request cannot block the entire queue.

Native reads and writes across Linear, the plugin journal and Paperclip do not
form a transaction. Readiness is an observation requiring receiver revalidation.
The native relation helper reads/unions/replaces a blocker set without an atomic
merge. Importer concurrency is serialized per effect; concurrent foreign
relation writers require coordination. Readback rejects observed foreign
blockers instead of deliberately removing them. The Lot 3 isolated qualification has
no event subscribers; it proves the importer's lack of wakes and native default
behavior, not the behavior of arbitrary third-party listeners.

## Separate Council receiver

Lot 3 still records preparation only. The separately qualified Council `0.7.18`
receiver accepts `plugin:ty000.linear-intake` under exact source/company/project
bindings and an enabled mandate. It validates native readiness, source documents,
hierarchy and blockers, then obtains a fresh source observation from intake
`0.4.0` over the authenticated native bus. It prepares contributor assignments
and `council-work.ownedPaths` from explicit project rules, preserves terminal
history and admits through its own budget, mission and attempt identities.
See the [handoff contract](COUNCIL-HANDOFF-V1.md),
[Lot 4 ledger](qualification/COUNCIL-RECEIVER.md) and
[public receipt](qualification/council-receiver-qualification.json).

At least one executable descendant is required; standalone roots, terminal-only
families and external source blocker references remain blocked. Intake never
wakes an implementation agent or writes Council's private database. The Lot 4
installed qualification exercises the intended intake/Council subscribers, not
the behavior of arbitrary third-party subscribers. Readiness retains
`receivingContract: "unqualified"` and both admission/execution flags remain
false: Council's separate admission and run evidence establish the later state.

Council's closed issues 50 and 51 qualify its own manual-origin mandate and
hierarchy work; those historical proofs alone do not qualify this receiving contract. A connector's
presence, a prepared family or a green importer CI is not Council admission.
