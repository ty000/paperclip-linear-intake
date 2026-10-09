# Todo intake and handoff contract

Status: Lot 1 source access is qualified natively. Lot 2 request retention and
source retrieval are implemented and qualified in isolation in `0.2.0`.
Lot 3 native preparation is implemented and qualified in isolation
in `0.3.0`. Lot 4's intake `0.4.0`/Council `0.7.18` handoff is qualified in
isolation; Council owns admission. See the [Lot 4 ledger](qualification/COUNCIL-RECEIVER.md),
[readiness v1](NATIVE-READINESS-V1.md), [source qualification](qualification/SOURCE-READER.md)
and [retention semantics](qualification/TODO-RETENTION.md).
Scope: one ticket entering an explicitly configured Todo state and its selected subtree.

## Configuration and authority

Activation binds exact Linear organization, team, project and Todo-state IDs to
one Paperclip company/project. Council admission additionally requires a
currently enabled mandate; Lots 2 and 3 do not bind or validate that mandate. It also
declares eligible initiating actors, read credentials, webhook-secret reference,
source-size bounds, and the activation boundary.

Todo is an execution request inside that configured authority. It does not
increase budget, grant merge/deployment rights, or supersede Council admission.
Configuration starts disabled. Existing Todo tickets are not implicitly adopted
at activation; an initial inclusion must be explicit.

## Event acceptance

1. Verify the Linear signature against the exact raw request body, timestamp,
   source organization and configured endpoint.
2. Accept the configured `Issue` update only when it changes the workflow state
   from a different state into the exact configured Todo state. Retain the
   provider delivery ID and source event identity.
3. Durably retain the request before acknowledging a valid delivery. Perform
   source retrieval and import in a native job after acknowledgement.
4. Re-read the complete current issue before import. A stale event for work
   withdrawn from eligibility does not start an implementation run.

Duplicate deliveries refer to the same retained intake. A later transition back
into Todo does not automatically create a second attempt for already-managed
work. Any new-attempt policy must retain history and receive explicit authority.

## Source selection

- A selected parent authorizes its remaining descendant work even when those
  descendants are still in Backlog.
- A selected child authorizes its own subtree, not siblings or an unselected
  ancestor's complete scope. Preserve external ancestry as source context.
- Retrieve full descriptions, complete descendant pagination and typed blocking
  relations. A list preview is not a complete source description.
- Preserve completed/canceled descendants and historical outcomes in the source
  snapshot; do not restart or fabricate evidence for them.
- Preserve unresolved external blockers. Do not import their execution scope or
  remove dependencies without authorization.
- A cycle, incomplete inventory, exceeded configured bound, or missing decisive
  criterion produces an explicit waiting/blocking result.

## Native import and uncertainty

Each imported native task carries the Linear organization/issue identity under
the importer's own plugin origin. Use native SDK tasks, documents and relations,
with a persisted correspondence for each source object and effect.

Persist intent before a create/update effect. After interruption or a lost
response, reconcile the original identity with native readback. An inconclusive
result remains uncertain; do not repeat a create or use a replacement identity.

The family remains ineligible for Council until all selected objects,
descriptions, source revisions and relations have been read back and the
revision-pinned readiness document is complete. Native task creation must not trigger
implementation wakes before this boundary. Event delivery alone cannot replace
this durable readiness check.

Paperclip documents are mutable. The importer pins the observed identity,
revision and content hash and rejects drift; the SDK supplies no native
immutability guarantee.

## Council handoff

The versioned handoff identifies the intake, source snapshot, native root and
children, dependency mapping, project/mandate identity, and readiness revision.
Council revalidates the configured source and current mandate before admission.
Its existing budget and run identity remain authoritative.

Council `0.7.18` accepts the exact origin `plugin:ty000.linear-intake` under
company/project/source bindings and an enabled revisioned project mandate.
Imported provenance is preserved; no manual-origin relabeling or operator
impersonation is used.

Explicit project rules map executable source UUIDs to contributors and
`ownedPaths`. Council persists each preparation intent before atomically changing
assignment and status to Backlog, creates revision-pinned `council-work` documents and
reads effects back. An uncertain absent effect is not dispatched again. Intake
invents neither assignees nor paths. Done/cancelled descendants remain unassigned
history, excluded from execution and newly completed work. This receiver requires
at least one executable descendant and refuses external source blocker references.

The authenticated native-bus challenge binds readiness, activation, fingerprint,
request version, source/plan digests and Council mandate/admission identity.
Intake revalidates its ledger and complete current source. Council consumes a
fresh positive observation before preparation and again before initial N1
admission. The shared N1 boundary also requires that durable admission proof for
direct Board calls, before reservation and activation CAS. Expiry retains any
existing reservation under its original command and identity. See the
[current-source handoff contract](COUNCIL-HANDOFF-V1.md).

The integration must not report “implementation started” until native Council
admission and its actual run binding are observed. Prepared import evidence alone
never grants admission. Later remote Linear changes do not automatically cancel
an admitted mission; Council retains native-source, mandate and budget gates.

## Recovery and operator visibility

Use a native scheduled job to resume retained requests and reconcile missing
events. Initial activation and any catch-up selection must keep the configured
boundary; recovery must not sweep all historical Todo tickets.

Expose distinct states for received, fetching, importing, prepared,
admission-blocked, admitted, withdrawn and outcome-unknown, with source links and
the next required action. Lot 2 implements `received`, `fetching`, `source_observed`, `withdrawn`
and `blocked`. Lot 3 separately journals `preparing`, `prepared`, `blocked` and
`outcome_unknown` plans and intended/dispatched/observed/uncertain effects.
Council separately owns its challenge, preparation, mission and admission
journals and native inspection surfaces. This adds no importer `admitted` state
or cross-plugin database ownership. A withdrawn request can retain a
partially prepared historical plan; it cannot dispatch new effects or become
prepared under the former request revision.

No Slack integration, Linear status writeback, merge or deployment is introduced
by this contract. The isolated handoff proof does not use or qualify a real model
provider or real-ticket execution.
