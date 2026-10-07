# Council current-source handoff v1

Lot 4 is qualified in an isolated native instance using intake `0.4.0`
(`00c314181043a76ffbadad1721494f49893079ea`) and Council `0.7.18`
(`1b5269ce8ca10a680f27a737b6a075b385477b30`), based on Council
`751a82bce5436e7c54cda05e9db9fc92db072534`. Host code remains unchanged at
`61b3fd57a695614dc4a37e2303f426a34a9795cf`. See the
[criterion ledger and replay limits](qualification/COUNCIL-RECEIVER.md) and
[public receipt](qualification/council-receiver-qualification.json).
Operational installation, real webhook/credential enrollment and real-ticket or
model-provider activation remain separate and were not performed by this lot.

The immutable `linear-native-readiness.v1` remains preparation evidence.
Its `admissionAllowed:false` is unchanged. Council requires an explicitly enabled
project mandate, complete native family readback, exact contributor/write-scope
rules and a fresh source observation before its own admission. Only Council owns
mission creation, reservations, execution order and agent dispatch.

## Opt-in and migration

`councilHandoffEnabled` defaults to `false`. It requires configured native import,
the existing scoped gateway and secret reference, and explicit
enrollment of that complete configuration. The flag changes the enrolled
configuration fingerprint only when true. Disabled/default use preserves 0.3.0
fingerprints; this release does not migrate or adopt historical plans into a new
activation. Configure the intended handoff before retaining new requests.
The `enabled` switch may suspend and resume all processing while preserving the
flag and enrolled fingerprint. A suspended configuration performs no source reads.

No extra gateway, operator token or interplugin secret is introduced. The
existing gateway still reads Linear; the native Paperclip bus carries the
request and response between these two plugins in the same instance.

## Authenticated, durable request and bounded observation

Council persists a nonce and immutable request before emitting
`plugin.private.paperclip-council.linear-intake-revalidation-request`. Intake
accepts only that exact host-authenticated namespace, plugin actor and company.
The request binds the existing Council admission/mission ID, mandate revision,
intake/activation/configuration/request revision, source/plan digests, native
root/project and immutable readiness document/revision/receipt digest.

Intake compares those identities against its own durable binding, retained
request and prepared plan before any source call. Every import effect must be
observed. It rereads the immutable readiness and complete current source with
authority checks around each gateway call, then rechecks the readiness and
authority. All reads use its own enrolled scope; the request supplies no URL,
credential or broader source authority.

It emits `plugin.ty000.linear-intake.linear-intake-revalidation-result` with the
exact original request, canonical request digest, fixed status/reason and
observation/expiry timestamps. Requests expire within five minutes; a successful
observation must finish before expiry and remains valid for at most two minutes.
One process-local read slot bounds concurrent requests. Notification failure or
concurrent traffic is safely lost; Council retains pending state and retries
read-only requests. No event guarantees durable delivery or admission.

Council authenticates the response envelope, matches its persisted nonce,
revalidates the enabled owner/mandate and consumes a fresh positive result once.
This happens before preparation and again before initial N1 admission. An expired
challenge may be renewed under the same admission identity; no uncertain import
or preparation effect is retried under a replacement key. The shared N1 boundary
checks the consumed durable admission receipt and exact journaled activation
payload, including direct Board calls, before reservation and before activation
CAS. If freshness expires during reservation, that original reservation is
retained; renewal cannot replace its command or effect identity. Initial admission is
the remote-source boundary: later Linear changes do not silently cancel an
already admitted mission. Council continues to enforce its pinned native source,
mandate and budget rules.

## Hashes and evidence

The canonical digest recursively sorts object keys using the existing JavaScript
`localeCompare` order, serializes JSON, then hashes UTF-8 with SHA-256. Both
repositories carry the same synthetic contract vector. It is a schema/hash test,
not an authenticated native receipt.

`readinessSha256` hashes the ledger receipt `{nativeId, revisionId,
revisionNumber, contentSha256, nativeRootId, planSha256, sourceSha256}`.
`contentSha256` hashes the exact document intent, including its JSON body string.
Neither value is interchangeable with a digest of the parsed readiness body.

The importer reads its own ledger and native readiness only. It does not write
Council tables, consume a budget, prepare contributor assignments or wake agents.
Council separately journals its native preparation delta (Backlog plus assignment
in one write, immutable ownedPaths documents) while preserving imported source
history and readiness unchanged.

## Receiving scope and qualification

The project mandate explicitly maps executable source UUIDs to contributors and
repository paths. This receiver requires at least one executable descendant and
refuses external source blocker references; it does not invent subtasks, infer
ownership or widen the selected subtree. Done/cancelled descendants remain
history and cannot become new contributions or closure targets.

L4-A through L4-E passed in the installed native scenario. Four imported issues
retained their full source descriptions, hierarchy and blockers. Three successful
runs executed the coordinator and two leaves in dependency order; the cancelled
historical child and original product root had no run. Duplicate delivery and a
Council-worker restart retained one request, one intake and one mission. The
campaign stopped at settled N1 `ready_for_review`, before N2. Linear HTTP and CLI
model content/usage were deterministic fixtures; whole-host/intake-worker restart,
real-provider behavior and operational deployment are not claimed.
