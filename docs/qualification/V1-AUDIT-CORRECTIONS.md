# V1 audit corrections

These corrections address the PRD/TAD review after the campaign implementation.
They keep the initial milestone scope and use the existing native commands,
publication journal and continuity exchange.

| Finding | Result | Owning surface |
| --- | --- | --- |
| F01 — source restoration resumed silently | Persist source diagnostic and suspension; explicit owner resume is required even after a lost alert or worker restart. | Intake reader/publisher and Council control |
| F02 — incomplete final evidence | Include criterion proof references, PRD/TAD versions and hashes, configured native campaign link and observed comment identity. Preserve historical bodies and receipts. | Intake publication |
| F03 — transient initial read failure stranded intake | Board retry uses the same intake identity, exact version and enrollment, at most three total reads, before any import plan. | Intake command and journal |
| F04 — cancelled campaign retained repository forever | Accept historical terminal technical results once runs, effects and budgets are reconciled; product nodes still must finish or cancel. | Council repository release |
| F05 — cancellation refused at local closure intent | Council authorizes terminal publication by CAS after intake readiness. Before that claim the intent remains cancellable; after it, reconcile the original effect. | Paired continuity protocol |
| F06 — cancellation lost member results | Summarize retained integrations, open PRs and remaining member work. | Council payload, Intake rendering |
| F07 — occupied repository acted as an automatic queue | Persist the admission hold; the project owner explicitly resumes the same retained intake. | Council admission |
| F08 — investigations without repository changes | Explicitly defer them in PRD/TAD; the V1 pilot uses implementation leaves. | Product scope |

F09 (authority and complete proof revalidation at closure) was already corrected
in Council PR #91 and is a dependency of these changes.

The source checks include worker contract tests and disposable PostgreSQL tests
for retries, concurrent CAS, source holds, original publication identities,
terminal permission and response loss. Council separately checks cancellation,
repository holds, review authority and terminal control races. Exact counts and
candidate identities are reported with each PR; earlier installed qualification
remains attached to its original candidates.

This does not activate recette or qualify real Linear output shapes, write
permissions or model-provider execution. The public HTTPS webhook remains an
operational prerequisite. The real gateway profiles, company/project enrollment,
publisher URL and project mandate must still be qualified before the pilot.
See [the pilot plan](V1-PILOT.md) and
[publication qualification](CAMPAIGN-PUBLICATION.md).
