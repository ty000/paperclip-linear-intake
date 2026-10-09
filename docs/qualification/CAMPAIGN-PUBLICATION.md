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

An authentic native event from `private.paperclip-council` locates an immutable
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

One root-ticket comment includes the original intent ID and payload hash. Exact
content plus marker, with complete bounded pagination, qualifies its readback.
This is not a claim of native comment immutability. Optional `statusUpdates`
contains at most 33 `{sourceId, state: "started"|"completed"|"cancelled"}` entries;
only originally active members can be targeted. Historical completed/cancelled
members are never rewritten. Terminal states cannot be reopened. A repeated
already-confirmed own state is read back without another status write; a manual
preexisting desired state is not adopted.

The comment precedes status changes. A terminal root status is last, after all
preceding effects have read back. The entire intent receives one immutable native
receipt only when every effect is confirmed. A lost response is reconciled under
the same intent; even a complete empty readback never authorizes another comment.
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

Responses contain exactly `fixed-source` and `publication-readback`, no changes,
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
`{comments:[{id,body,issueId?}],hasNextPage,cursor?}` with complete pagination; issue
readback requires the full qualified reader shape. A differing native output
fails closed. A real publication profile, output readback and permission scope
must still be qualified explicitly before activation. This lot performed no real
Linear writes, recipe migration, installed-host change or provider run.
