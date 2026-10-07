# Council receiver qualification — Lot 4

**L4-A through L4-E: PASS within isolated native qualification.** The campaign
finished at `2026-10-07T23:01:03.889Z` with outcome
`NATIVE LINEAR COUNCIL ADMISSION VALIDATED`. The
[public receipt](council-receiver-qualification.json) binds the observations,
checks, cleanup and package hashes. This qualifies the installed intake/Council
path through N1; it does not install or activate either release in recipe.

## Exact candidates and evidence

| Surface | Tested version and commit | Base / contract |
| --- | --- | --- |
| Intake | 0.4.0 — `00c314181043a76ffbadad1721494f49893079ea` | Base `0488cb7b799d015db69760e5a4603a333f3f4637`; SDK `2026.1005.0` |
| Council | 0.7.18 — `1b5269ce8ca10a680f27a737b6a075b385477b30` | Base `751a82bce5436e7c54cda05e9db9fc92db072534`; SDK `2026.916.1` |
| Paperclip host | `61b3fd57a695614dc4a37e2303f426a34a9795cf` | Clean prepared checkout; core and SDK sources unchanged |

The retained private proof has SHA-256
`b6336e50687010fecc183c2c45037c29126dc3bf4459e0f2442af794b375b8b1`.
The public receipt preserves 103 Council and 31 intake runtime JavaScript
digests, migration digests, and hashes of complete package manifests containing
523 and 127 entries respectively. Those complete manifests cover source,
migrations, package metadata and recursive build files. Before/after package
bytes matched. Server and database cleanup passed; historical runtime evidence
was retained. Documentation follow-ups do not replace these tested code SHAs.

## Criterion ledger

| Criterion | Verdict | Observed evidence | Bound |
| --- | --- | --- | --- |
| L4-A — complete handoff and current authority | PASS — isolated native | Four imported tasks; complete 36,300-character root description; authenticated positive preparation/admission challenges consumed. Disabled mandate and pending response produce zero missions, runs, wakes or reservations. Early Board activation returns 409 `linear_source_pending` with zero reservations. | Linear source content is deterministic; immutable readiness alone is never admission. |
| L4-B — existing Council admission/accounting | PASS — isolated native | One retained mission and original period; three settled initial reservations; one budget-configuration receipt; 450 known usage units. Rejected Board reservation is not adopted. | Native accounting, deterministic model usage; no claim about real provider token accuracy or prices. |
| L4-C — subtree and dependency order | PASS — isolated native | Three successful runs: coordinator, alpha and beta; alpha finishes before beta starts. Cancelled historical child and original product root have zero runs. Descriptions, parent links, origins and blockers are preserved. | One root, two executable descendants and one cancelled historical descendant; N1 stops at `ready_for_review`, before N2. |
| L4-D — duplicate delivery and restart | PASS — isolated native | Duplicate signed webhook retains one request with one attempt. Changed Council-worker PID preserves the pending challenge, intake and mission identities; final inventory contains one intake and one mission. | Council worker restart only; no whole-host, database or intake-worker restart is claimed by this campaign. |
| L4-E — ownership and permitted effects | PASS — isolated native | Zero importer/premature wake, native scheduled jobs, only Council-admitted runs, no budget reset or core/SDK edit. Plugins keep their own journals. | SQL bootstrap creates only the synthetic native owner identity/membership/admin role; no plugin business state is seeded. Harness journal reads are observations, not cross-plugin runtime access. |

The receiver supports done/cancelled history in source and synthetic tests. This
native scenario proves the cancelled case; it does not add a native done-history
case. Source revalidation before preparation and admission is separate from
Council's later pinned native-source and mandate checks.
Source withdrawal, expiry and refused attestations are covered by targeted
synthetic tests, not extra native scenarios in this campaign.

## Verification layers and retained failures

Intake passed 476 package/worker tests and 169 isolated PostgreSQL tests. Council
passed 980 tests with one skip. Exact-candidate CI passed for
[intake](https://github.com/ty000/paperclip-linear-intake/actions/runs/37697670054)
and [Council](https://github.com/ty000/paperclip-council/actions/runs/37699064473).
Repository static wrapper gates passed. The additional raw Council Fallow
report retains a failing native verdict with six introduced noncritical
complexity findings and no introduced dead code or critical complexity. A
passing wrapper/CI does not erase that raw result or mean zero findings; no
further cleanup is claimed here.

Three earlier native campaigns remain **BLOCKED** in the receipt, with their
original hashes, candidates and cleanup observations:

| Historical campaign | Diagnosed blocker |
| --- | --- |
| `native-Y9jynL` | Host rejected Council's explicit foreign-plugin `originKind` list filter before the source challenge. |
| `native-OIyLOi` | Preparation required strict `null` for optional native `archivedAt` enrichment. |
| `native-x3WMog` | Qualification fixture forced `PAPERCLIP_IN_WORKTREE=1`, suppressing the native wake while preserving its original identity. |

Only the final `native-zeQZ4v` campaign qualifies the candidates above. Fixes and
later success do not rewrite those failures or the Lot 1/2/3 historical proofs.

## Receiver and operational limits

The [handoff contract](../COUNCIL-HANDOFF-V1.md) requires explicit enrolled source
authority and an enabled revisioned Council project mandate with contributor
and `ownedPaths` mappings. It introduces no operator-token reuse or interplugin
credential. At least one executable descendant is required; standalone roots,
terminal-only families and external source blocker references remain blocked.

The [immutable readiness contract](../NATIVE-READINESS-V1.md) remains unchanged:
`admissionAllowed: false`, `implementationStarted: false`, and
`receivingContract: "unqualified"`. Council's separate receipts and actual run
bindings establish its later admission/execution state. Later remote Linear
changes do not automatically revoke an already admitted mission.

Installed workers, event bus, scheduled jobs, native APIs, admission, heartbeat
runs and accounting are real. Linear MCP HTTP responses and CLI model
content/usage are deterministic fixtures; no real Linear workspace or model
provider is contacted. Identity-only SQL setup is explicit. Business state is
created through native APIs and plugin workers. Council is suspended after
settled N1; N2, review quality, acceptance, publication, merge, deployment and
real-provider execution are outside this proof. No operational webhook,
credential enrollment, real-ticket import or recipe installation occurs.

## Isolated replay

Use the exact clean candidates above with their matching built packages,
installed locked dependencies and a prepared read-only host checkout at the
pinned host commit. The Council launcher provisions a disposable local runtime
and PostgreSQL database and stops them in cleanup. Never target recipe.

```sh
cd /path/to/paperclip-council-at-1b5269c
PAPERCLIP_TEST_HOST_ROOT=/path/to/clean-prepared-paperclip-at-61b3fd57 \
LINEAR_INTAKE_TEST_REPOSITORY=/path/to/built-linear-intake-at-00c3141 \
corepack pnpm qualification:native:linear-intake
```

LIVE authorization flags must not be enabled; the launcher rejects them. Each
replay creates a new isolated scenario and reports its own `proof.json` path.
Preserve all earlier evidence. A replay is distinct from operational activation
and from the source/build checks in [the implementation plan](../IMPLEMENTATION-PLAN.md).
