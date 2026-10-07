# Lot 2 — Todo request retention

Status: implementation complete in source `0.2.0`; isolated verification and
independent review in progress. Recipe remains on disabled `0.1.4`. No real
webhook, import, admission, agent wake or Linear write is part of this proof.

## Acceptance ledger

These IDs map the unchanged Lot 2 acceptance checks in the
[implementation plan](../IMPLEMENTATION-PLAN.md).

| ID | Required result | Evidence | Status |
| --- | --- | --- | --- |
| L2-A | One retained request for an authorized Todo transition; other updates cannot start work | Raw-body webhook tests and SDK hook with isolated PostgreSQL | Pending final run |
| L2-B | Invalid signatures, scope and withdrawn work cannot launch | Signature/actor/scope tests, durable withdrawal and source eligibility tests | Pending final run |
| L2-C | Duplicate/out-of-order deliveries and restart preserve identity | Concurrent SQL tests, interruptions before/after every persistence write, new runtime over the same database | Pending final run |
| L2-D | Persistence precedes ACK; source reads run outside the callback | Actual SDK hook/job handlers, durable database readback and synthetic managed-gateway transport | Pending final run |
| L2-E | Enabling configuration does not adopt historical Todo tickets | Explicit activation boundary, disabled/unbound job tests, no source-wide scan | Pending final run |

## Activation and suspension

The plugin declares one native webhook (`linear-todo`) and one scheduled job
(`drain-intake`, every minute). Both start inert. A valid enabled configuration
must include the pinned source-reader scope, gateway and native secret reference,
plus `intake.webhookId`, `intake.webhookSecretRef`, `intake.targetProjectId` and an
exact list of initiating `{id, type}` actors. Secrets are native references only.
The target project is a configured mapping reference at this stage; Lot 3/4
must verify native project and receiving mandate authority before any import or
admission.

Only an authenticated operator action with a matching native company context
can call `activate-intake`, `deactivate-intake` or `inspect-intake`. Caller
parameters cannot supply that authority. Enrollment persists a single primary
company binding, a server-generated activation identity and timestamp, and a
fingerprint of the complete validated configuration (excluding `enabled`).
Another company cannot replace it. Repeating activation with the same active
configuration preserves the original boundary. Changed authority requires
explicit deactivation followed by activation.

`enabled: false` suspends reception and job processing. Resuming the same
configuration keeps the existing activation epoch. It does not retrospectively
exclude events created during suspension. Use `deactivate-intake` to revoke the
epoch durably, then explicitly activate to establish a new boundary. The worker
does not infer configuration history from callbacks: host crashes do not replay
all configuration changes, and an unobserved false/true interval cannot be
reconstructed. A signed event predating the enrolled boundary is ignored.
Enabling configuration alone creates neither a binding nor requests.

## Delivery and recovery

The webhook verifies HMAC-SHA256 over the exact raw UTF-8 body, checks the signed
timestamp within 60 seconds, validates the provider delivery UUID, and matches
organization, webhook, team, project, exact Todo state and initiating actor. It
ignores the host's parsed body and random per-request ID. The provider delivery
ID is retained with the authenticated body's hash; a collision with different
bytes is rejected. Payloads are bounded to 2 MiB.

A valid transition first appends its normalized delivery, then updates the
request projection with a compare-and-swap, then marks the delivery applied.
Only then does the hook resolve so the host can acknowledge it. Any interrupted
write leaves the same identity available for replay. The native SDK exposes
single-statement DML and `rowCount`; no cross-call transaction is assumed.
An unapplied delivery prevents a claim or source-result publication for that
issue until replay completes. Fixed error codes exclude credentials and source
contents from hook/job error messages.

The request identity derives from company, Linear organization and issue UUID.
Out-of-order revisions cannot replace newer observations; withdrawal wins a
shared revision. A withdrawal before initial acceptance is retained as a
tombstone. Already accepted work cannot be rearmed by another Todo transition,
including after a new activation epoch. Delivery records retain the event
history without inventing replacement request identities.

The scheduled native job replays at most 20 retained unapplied deliveries and
claims at most one pending source request per invocation. Recovery scans only
this journal; it never enumerates all current Todo tickets. A 240-second lease,
owner and request version protect completion. Worker loss permits at most three
claims under the original request identity. A known source-read failure becomes
`blocked`; it is not automatically retried. Explicit deactivation invalidates
claims and completions belonging to that epoch.

A Todo transition never received or retained cannot be reconstructed by this
lot: the connector does not provide a qualified durable event journal with the
initiating actor. This remains a gap in the broader recovery contract. For a
retained request, re-reading current eligibility reconciles missing withdrawal
signals; the current Todo interval's `startedAt` must not postdate the retained
transition revision. This check runs before reading descriptions and again on
the complete family, so an unseen exit/re-entry cannot reuse old authority.

The job first reads the selected issue's identity, scope, current state and
archive status. Ineligible work becomes `withdrawn`. Eligible work goes through
the Lot 1 complete-family reader, including repeated details and child
inventories, with its configured request/size bounds and per-call timeout.
The eligibility check is one additional tool call, with its own authenticated
catalog session. A coherent snapshot is stored only after checking the active
binding, configuration fingerprint, request version, owner and live lease.
`source_observed` is evidence of a read, never import readiness or admission;
later lots must revalidate eligibility before effects.

Version `0.2.0` action responses use `importEnabled: false`; the former
`intakeEnabled: false` qualification field would misrepresent active retention.
Historical `0.1.x` native receipts and their summarizers retain their original
format. Current retention state is available through `inspect-intake`.

## Evidence layers and reproduction

`npm run check` uses the published SDK, actual worker JSON-RPC and deterministic
transports. `npm run test:postgres` additionally applies the shipped migration
to an isolated PostgreSQL 18.1 database and exercises durable storage plus the
SDK's registered hook and scheduled job. Its database adapter mirrors the native
single-statement `execute`/`rowCount` and read-only `query` contracts. Tests fail
when the dedicated database URL is missing; they do not silently skip.

Use only a disposable local database and user both named `intake_test`, provided
through `INTAKE_TEST_DATABASE_URL`. Tests recreate the plugin's schema there.
The exact namespace is `plugin_linear_intake_e8c339297d`, derived by the host from
plugin ID `ty000.linear-intake` and namespace slug `linear_intake`. The package
contains `migrations/001_intake.sql` and CI runs the PostgreSQL tests separately.

These checks establish code, SDK protocol and real SQL durability with synthetic
Linear/host services. They do not establish an operational Linear webhook or an
installed/activated `0.2.0` worker in recipe. Lot 1's existing native source proof
remains separate and unchanged.

The payload shape follows Linear's [webhook documentation](https://linear.app/developers/webhooks)
and the official SDK's `IssueWebhookPayload` schema at commit
[`7d2bc427`](https://github.com/linear/linear/blob/7d2bc4279f1887cf763c59f9a173d9c590620023/packages/sdk/src/_generated_documents.ts).
Unknown or incomplete decisive fields fail closed. A native webhook campaign is
still required before operational activation.
