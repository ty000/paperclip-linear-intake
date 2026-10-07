# Implementation sequence

Status: Lot 1 partially implemented. Native recipe catalog access and secret
binding are now observed; complete source-family retrieval remains unqualified.
The disabled package is installed for recipe qualification. See the
[current native evidence](qualification/NATIVE-ACCESS.md).
Lots 2 and 3 must not start until all L1-A through L1-G criteria are satisfied.
The acceptance checks below remain authoritative and unchanged.

Local transport continuation: the operator approved an opt-in direct loopback
client while VPS deployment is deferred. Its scope is plugin-only code, tests
and documentation; see [local transport qualification](qualification/LOCAL-TRANSPORT.md).
It removes the public-HTTPS prerequisite for local testing, not the native
gateway, secret-binding or complete source-read qualification requirements.

## Lot 1 — Qualify native source access

Establish the plugin's package/worker skeleton against the identified Paperclip
SDK, disabled by default. Qualify a dedicated read-only named gateway using the
managed Linear connection and deterministic fixtures.

Acceptance:

- Actual available tool schemas are recorded; no guessed tool names or fields.
- Complete issue descriptions, children, blockers and pagination are obtained.
- Reads work without an implementation-model run or an operator token in the
  plugin.
- Secret references are resolved through native facilities and never exposed.
- Any connector coverage or transport gap is recorded before selecting a
  bounded official GraphQL fallback.

## Lot 2 — Receive and retain Todo requests

Use the native plugin webhook and native jobs. Add exact state-transition and
scope matching, verified delivery identities, durable request storage,
activation boundaries and a recovery scan.

Acceptance:

- Valid Todo transition produces one retained request; other updates do not.
- Invalid signatures, wrong scope and stale withdrawn requests cannot launch.
- Repeated delivery, out-of-order events and worker restart preserve identity.
- Acknowledgement follows persistence; source reads happen outside the callback.
- Enabling a configuration does not silently adopt historical Todo work.

## Lot 3 — Import a complete native family

Create native waiting tasks, source documents and relations through the SDK.
Persist the Linear/native correspondence and effect intent; qualify partial
import and uncertain-response recovery. Publish readiness only after complete
native readback.

Acceptance:

- Parent and three children retain full descriptions and a blocking dependency.
- Child selection does not widen to siblings; completed history is preserved.
- Incomplete families remain ineligible and do not wake implementation agents.
- Concurrent processing, a lost create response and restart produce no second
  family or replacement identity.
- External blockers and cycles remain explicit; no relation is silently removed.

## Lot 4 — Qualify the receiving Council adapter

Use an isolated Council lot for the allowlisted imported origin and versioned
readiness contract, after the hierarchy candidate has its own qualification.
Resolve contributor/write-scope preparation through authorized project rules or
the governed lead path.

Acceptance:

- No root is admitted until the complete handoff and enabled mandate are read.
- Admission uses Council's existing accounting and permitted effects.
- A representative subtree follows dependency order under native orchestration.
- Duplicate signals and restart retain one intake, mission and attempt.
- No importer wake, direct Council database write, fabricated owner identity or
  budget reset is used.

## Integration proof and activation

The first integration qualification uses an isolated native Paperclip instance
with deterministic Linear/model transports. It must demonstrate Todo event →
complete import → observed Council admission, including duplicate delivery and
restart. Record exact source/package/host versions and distinguish simulated
provider behavior from native host effects.

Installation in the operational instance, creation of the real Linear webhook,
credential enrollment and real-ticket/provider activation are separate concrete
steps after the package and receiving adapter are qualified. No such effects are
performed by repository bootstrap.
