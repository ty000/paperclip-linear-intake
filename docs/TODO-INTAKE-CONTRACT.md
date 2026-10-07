# Todo intake and handoff contract

Status: intake/import/handoff contract proposed, not implemented. Lot 1 provides
a disabled skeleton, source probe and complete-family reader pending native
qualification; see [current qualification](qualification/SOURCE-READER.md).
Scope: one ticket entering an explicitly configured Todo state and its selected subtree.

## Configuration and authority

Activation binds exact Linear organization, team, project and Todo-state IDs to
one Paperclip company/project and a currently enabled Council mandate. It also
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
immutable readiness document is complete. Native task creation must not trigger
implementation wakes before this boundary. Event delivery alone cannot replace
this durable readiness check.

## Council handoff

The versioned handoff identifies the intake, source snapshot, native root and
children, dependency mapping, project/mandate identity, and readiness revision.
Council revalidates the configured source and current mandate before admission.
Its existing budget and run identity remain authoritative.

Two receiving gaps must be resolved separately:

1. Council's current intake requires `originKind === "manual"`. Imported plugin
   origins need explicit, allowlisted acceptance rather than falsified manual
   provenance or operator impersonation.
2. The in-progress hierarchy path requires an assigned contributor and a
   `council-work` document with explicit `ownedPaths` for every executable leaf.
   The import cannot invent those scopes. Obtain them from authorized project
   rules or a governed preparation step by the lead before contributor launch.

The integration must not report “implementation started” until native Council
admission and its actual run binding are observed. Until a compatible receiving
contract is qualified, imports remain prepared or blocked.

## Recovery and operator visibility

Use a native scheduled job to resume retained requests and reconcile missing
events. Initial activation and any catch-up selection must keep the configured
boundary; recovery must not sweep all historical Todo tickets.

Expose distinct states for received, fetching, importing, prepared,
admission-blocked, admitted, withdrawn and outcome-unknown, with source links and
the next required action. These are design states, not an implemented schema.

No Slack integration, Linear status writeback, provider execution, merge or
deployment is introduced by this first contract.
