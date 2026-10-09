# Fixed campaign publication — source qualification

L3, version 0.6.0, adds an optional intake publisher for Council's authenticated
`council-linear-continuity-v1` protocol in `milestone-fixed-v1` mode. This document
covers source, synthetic SDK harness, and isolated PostgreSQL evidence. It does
not qualify a real Linear write, install or activate the publisher, or authorize
provider execution.

## Authority and configuration

`councilContinuityEnabled` defaults to false. Enabling it requires the existing
`councilHandoffEnabled` and a `publisher` configuration. The publisher's `enabled`
flag also defaults to false. Its URL and secret reference must differ from the
source reader's profile. Only secret references are stored.

The publisher configuration contains:

- optional `paperclipBaseUrl`: the actual Paperclip origin, HTTPS or HTTP loopback
  for local use, with no credentials, query, fragment or base path. It supplies
  the native `/issues/{nativeRootId}` campaign link and is part of enrollment.
  Configure it before enrollment; an absent value is shown explicitly and does
  not qualify the pilot's navigation requirement. No domain is inferred;
- `gatewayUrl`, `gatewayTokenRef: {type: "secret_ref", secretId, version?}`;
- `tools: {saveComment, listComments, saveIssue, getIssue}`, each with an exact
  catalog name and `inputSchemaSha256`;
- `states: {started, completed, cancelled}`, three distinct UUIDs, checked against
  the enrolled team's status types;
- `maxCommentPages` (default 10, maximum 20) and `pageSize` (default 100, maximum 250).

Only `save_comment({issueId, body})` and `save_issue({id, state})` are emitted.
The explicit role allowlist applies even if a catalog incorrectly marks a write
as `isWrite: false`. All four pins must address the source reader's connection.
The separate publication profile must expose the bounded readback tools too.
`publisher.enabled=false` suspends new writes without changing the enrollment
fingerprint, so already claimed effects can still be read and reconciled.
Revoking the complete intake binding or continuity authority also stops reads.

## Original identity and readback

An authentic native event from `private.paperclip-council` locates a revision-bound
request document through `nativeRootId`. Company, mission, campaign, project,
prepared import, material source hash, exact document revisions, nonce and
five-minute challenge are verified. No payload actor or replacement import can
supply authority. The first valid binding durably retains the original prepared
request; subsequent observations check that exact prepared plan and readiness.
The intake request's later withdrawal projection does not erase this binding.

Every publication persists its original Council intent ID, payload hash and
ordered effects before Linear dispatch. A per-campaign SQL compare-and-set slot
serializes different intents; per-row version checks arbitrate competing workers
for the same intent. No timeout releases an uncertain effect or invents a new key.

One root-ticket comment renders readable progress, source titles, versioned and
hashed PRD/TAD references, the fixed material-source hash, the enrolled Paperclip
campaign link, known pull-request links and the final criterion coverage. Each
coverage row includes its exact source hash, delivery/obligation references and
proof IDs alongside result, environment, method and remaining work. These IDs
identify native evidence; the campaign link provides navigation to it. An
annulation summary distinguishes verified integrations, integrations awaiting
verification, observed open PRs and remaining source work. Internal authority
bindings stay in native evidence; a discreet marker retains the original intent
ID and payload hash. Exact
content plus marker, with complete bounded pagination, qualifies its readback.
This is not a claim of native comment immutability. Optional `statusUpdates`
contains at most 33 `{sourceId, state: "started"|"completed"|"cancelled"}` entries;
only originally active members can be targeted. Historical completed/cancelled
members are never rewritten. Terminal states cannot be reopened. A repeated
already-confirmed own state is read back without another status write; a manual
preexisting desired state is not adopted.

The comment precedes status changes. A terminal root status is last, after all
preceding effects have read back. The entire intent receives one revision-bound native
receipt only when every effect is confirmed. New receipts also retain the
observed `commentId` and, when the provider's readback supplies it, `commentUrl`
on comment effects. Missing URLs are not fabricated. Older pinned receipts and
orphan receipt documents remain valid in their original format and are never
rewritten to add these fields. Their readback hashes and revisions still have to
match exactly. Previously retained comment bodies also remain byte-for-byte
unchanged across rendering upgrades, including pending or uncertain sends. The SDK permits document updates and
deletion; retaining the original body is an application rule, not native immutability.
A lost response is reconciled under
the same intent; even a complete empty readback never authorizes another comment.
Comment-only blocker/question/decision/cancellation intents use their own row CAS so a paused
status intent does not hide the owner’s control message. They never release or
acknowledge an older intent. Fully confirmed intents remain acknowledgeable during
pause. Other pending status intents retain their identity for owner resume; Council
still blocks new work until its full outbox is confirmed. Cancellation with an
uncertain or superseded pending status remains visibly blocked in V1; there is no
false confirmation or automatic disposition protocol.

A crash after claim but before send therefore remains blocked for explicit
operator investigation. There is deliberately no automatic retry/repair action
for this irreducible uncertainty.

## Fixed source revalidation

Initial preparation/admission remains strict Todo/source validation. Ongoing
observation rereads the complete campaign twice and compares its pinned material
hash, membership, hierarchy and protected fields. It permits only original states
or exact states with confirmed publication readback; pending claims grant no
state exception. Claimed effects are reconciled first so a lost status response
does not prevent its own readback. State authority uses terminal transition rules,
not process-local state or wall-clock ordering. A changed source remains blocked;
no remote command, context adoption or replacement campaign is implemented.

A failed observation retains a bounded diagnostic (field names, source IDs and
hashes, never changed text or upstream errors). Council persists the suspension.
The publisher also retains a source hold in its original binding: restoring the
source alone cannot resume pending writes, including from an old challenge or
after a worker restart. Only Council's explicit owner resume advances the
`resumeVersion`. A fresh source observation can report available while writes
remain held, allowing that explicit resume. The retained diagnostic accompanies
that available response too: losing the first alert cannot silently clear the
Council suspension. Diagnostic/control comments still
require current configuration, native readiness and the original root's project
scope; they never change status or confirm another intent.

## Terminal publication authorization

New fixed campaigns require `terminalPublicationProtocol:
"council-terminal-publication-claim-v1"` and a nonnegative `resumeVersion`.
Intake first retains a closure intent without claiming an effect or acquiring the
campaign publication slot. It reports `terminalClaimRequest` with the original
intent ID and payload hash. Council checks current source, mandate, review and
preceding publication receipts, then arbitrates this authorization against owner
pause/cancellation through the mission CAS. The next challenge carries the exact
`terminalClaim` (ID, hash, mission version and timestamp).

Only that grant authorizes the terminal comment and statuses. An old ungranted
challenge cannot publish success after cancellation. Before the claim, cancellation
withdraws the intent while preserving its history; after the claim, the terminal
operation must be reconciled under its original identity. A source hold still
requires explicit resume even if a grant had already been issued. Root completion
disguised as a progress publication is refused. Legacy fixed campaigns lacking
this protocol require explicit operator handling; there is no automatic adoption
of an already pending terminal effect.

Responses contain exactly `fixed-source`, `publication-readback` and
`terminal-publication-claim`, no changes,
and at most 32 confirmed acknowledgements per observation. Council retains its
outbox and owns transport retries. Acknowledgements reference the unchanged
`linear-publication-readback-v1` receipt contract.

## Evidence and remaining qualification

Synthetic SDK harness tests exercise authentic native envelopes, document
readback, separate secret scope, pagination, semantic pinning and bounded writes.
PostgreSQL 18.1 in a disposable dedicated `intake_test` container exercises actual
migrations, compare-and-set concurrency, lost responses, reconstructed worker
contexts, revocation and immutable identity. Existing reader/import tests remain
part of the full suite. The exact test/audit results are recorded with the commit
handoff; they are not evidence of production activation.

The cached real connector catalog supports the observed input roles. Output
shapes for publication have only fixture qualification: `list_comments` requires
`{comments:[{id,body,issueId?,url?}],hasNextPage,cursor?}` with complete pagination; issue
readback requires the full qualified reader shape. A differing native output
fails closed. A real publication profile, output readback and permission scope
must still be qualified explicitly before activation. This lot performed no real
Linear writes, recipe migration, installed-host change or provider run.

## Subsequent installed isolated qualification

The [complete campaign scenario](https://github.com/ty000/paperclip-council/blob/ecb8032bdc8f5608265b87c2317c7b979a835794/docs/LINEAR-CAMPAIGN-V1.md) subsequently exercised this publisher
with Council on a real disposable Paperclip host. Seventeen native runs produced
two private Git integrations, an independent fixture global review, confirmed
terminal publication, native closure and repository release. The [candidate
receipt](https://github.com/ty000/paperclip-council/blob/ecb8032bdc8f5608265b87c2317c7b979a835794/docs/linear-v1-campaign-native.json) records exact commits, package digests and cleanup. Linear,
GitHub and model responses remain fixtures; real gateway write qualification and
recette activation are still outstanding. The source-only evidence above retains
its original boundary.
