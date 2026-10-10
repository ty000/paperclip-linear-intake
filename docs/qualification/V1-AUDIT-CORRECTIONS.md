# V1 audit corrections

Historical first correction lot, intake 0.6.1 / Council 0.7.41. The fresh
10 October review found additional gaps; this coverage table is not a claim
of complete compliance. See [the bounded follow-up](V1-BOUNDED-CORRECTIONS.md)
for R01–R07 and the explicit current V1 limits. Original receipts below retain
their original candidates and scope.

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
in Council PR #91 and is included in the Council base of these changes.

The source checks include worker contract tests and disposable PostgreSQL tests
for retries, concurrent CAS, source holds, original publication identities,
terminal permission and response loss. Council separately checks cancellation,
repository holds, review authority and terminal control races. Exact counts and
candidate identities are reported with each PR; earlier installed qualification
remains attached to its original candidates.

## PRD/TAD coverage after correction

This is source coverage of the retained V1 scope. The PRD/TAD map M01–M10 to
acceptance scenarios A01–A08; fixture checks do not replace the real pilot.

| Requirement | Evidence and correction |
| --- | --- |
| M01 — recover context without the chat | Pinned source and publication details tests; F02 adds proof references, versions and configured Paperclip navigation. Human readability remains a pilot check. |
| M02 — exact, complete, unique engagement | Campaign source, webhook and import tests; F07 preserves an occupied-repository hold. |
| M03 — governed admission and budget | Council mandate, repository occupation and admission tests; F04/F07 make release and resumption explicit. |
| M04 — serial reviewed code deliveries | Council delivery predecessor and integrated-delivery tests. Investigation without repository changes is explicitly deferred (F08). |
| M05 — bounded, readable publications | PostgreSQL publication/readback tests and F01/F02/F06. |
| M06 — recoverable stop without scope expansion | Durable source hold, bounded initial-read retry and explicit occupied-intake recovery (F01/F03/F07). |
| M07 — preserve identity after interruption | Lost-response, restart and concurrent-effect tests, including original terminal permission (F03/F05). |
| M08 — pause, resume and cancel | Council control/claim race tests, terminal member reconciliation and cancellation summary (F04/F05/F06). |
| M09 — independent global closure | Council coverage/subject tests and current authority/proof checks (F02/F09). A Linear ACK alone cannot authorize later native closure. |
| M10 — disabled defaults and bounded permissions | Configuration, enrollment and compatibility tests; old fixed campaigns without the protocol marker require explicit treatment. |

No new product scope is added. Automatic replanning, parallel repository work,
automatic prerequisites, autonomous correction/revert and investigations without
repository changes remain outside this V1.

## Validation of the corrected pair

The [installed audit receipt](https://github.com/ty000/paperclip-council/blob/d12c1a1df5afcb4719273729a62d7bf662b04a5d/docs/linear-v1-audit-native.json)
records the successful 9 October 2026 run, completed at 22:20 UTC: intake
`3bae49255651fddc37e0c66b016ea73e8940d660` (`0.6.1`), Council
`60905259ef43af2edbafd2d2588abd991dd60db0` (`0.7.41`) and unchanged native host
`61b3fd57a695614dc4a37e2303f426a34a9795cf`.

Seventeen native runs succeeded, two deliveries integrated serially, eleven
global coverage rows were approved, and the exact terminal claim preceded its
readback and native closure. All reservations settled in the original period;
the repository was released. Cleanup stopped the host and database, retained
the raw report and confirmed unchanged source/build bytes. Later intake commits
change only CI or documentation; the receipt records their unchanged runtime
digests separately from the launch commit.

Source validation includes 525 application/worker tests, 220 disposable
PostgreSQL tests and 57 CI-gate tests, plus typecheck/build and independent
reviews. Council reports 1,407 passing tests and one skipped test. The Fallow
CI gate retains moderate estimated CRAP findings as explicit warnings, with
the unchanged native report; new code errors and higher-severity findings
remain blocking.

The nominal installed run exercises the new terminal permission protocol.
Fault recovery and cancellation scenarios retain their source/PostgreSQL
evidence; they are not claimed as installed fault-injection runs. Linear,
GitHub and model responses and token usage remain deterministic fixtures.
The legacy Todo receipt remains attached to its earlier candidates.

This does not activate recette or qualify real Linear output shapes, write
permissions or model-provider execution. The public HTTPS webhook remains an
operational prerequisite. The real gateway profiles, company/project enrollment,
publisher URL and project mandate must still be qualified before the pilot.
See [the pilot plan](V1-PILOT.md) and
[publication qualification](CAMPAIGN-PUBLICATION.md).
