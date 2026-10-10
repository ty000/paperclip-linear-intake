# V1 bounded corrections — 10 October 2026

This lot follows the fresh PRD/TAD audit of the merged intake 0.6.1 and Council
0.7.41. It corrects five concrete gaps and explicitly defers two exceptional
paths in PRD 0.4 / TAD draft 0.3. It does not introduce another transport,
orchestrator, budget, or automatic recovery workflow.

## Ownership and base

| Repository | Exact base | Candidate | Ownership |
| --- | --- | --- | --- |
| `ty000/paperclip-linear-intake` | `a6559d1d5be7d6b6f246470fbe8913de3d9cfc45` | 0.6.2 | R01/R02/R06/R07 code and tests; PRD/TAD scope and this ledger. |
| `ty000/paperclip-council` | `3dc8387b09012197a7d30ddabc45a1db1b0fc572` | 0.7.42 | R01 initial revalidation after resumption; R05 decision, plan publication and departure guard. |

Both branches start from merged `main` in separate worktrees. Paperclip core,
SDK, installed releases, recette configuration, real Linear/GitHub work and
model-provider execution are outside this lot. GitHub publication of the code
PRs is separate from product publication to Linear.

## Acceptance

| Finding | Required result | Status |
| --- | --- | --- |
| R01 — later Todo interval accepted after snapshot | Preparation/admission reject a later Todo interval under the original engagement, even with unchanged material content and missed withdrawal events; no replacement identity. Council also revalidates the original source before its first plan after a retained preparation/resumption. Expected post-admission transitions remain supported. | Source and composed Council tests pass |
| R02 — altered confirmed comment permits Done | Required comment identities/content are revalidated before dependent terminal effects. Missing/altered evidence holds the terminal permission request, status and ACK; no blind replacement send or historical rewrite. Informational questions/blockers do not become mandatory closure proofs. | Source tests pass |
| R03 — no individual stop before fixed mission | Explicitly deferred in PRD/TAD. A held occupied-intake request does not resume itself. Global disable is not represented as individual cancellation. | Deferred, not implemented |
| R04 — post-integration recovery blocked by occupation | Explicitly defer resumption of the same campaign after a failed integration. Preserve hold/evidence and reconciliation requirements; no automatic repair/revert. | Deferred, not implemented |
| R05 — occupied-intake resume skips published arbitration | Retain question, author, answer and consequences; include the decision in the first plan and require its readback before dependent departure. | Source and composed Council tests pass |
| R06 — publisher revocation prevents source diagnosis | Reader observation remains independent when publisher authentication fails; writing/progression stay held. An unreconciled own status cannot create a false durable source hold or be promoted to confirmed. | Source tests pass |
| R07 — final summary lacks objective/navigation | Include the pinned milestone objective and already observed useful comment references in future final summaries, without inventing links or rewriting historical bodies. | Source tests pass |

## Evidence boundary

The prior 17-run installed qualification remains attached to intake 0.6.1 /
Council 0.7.41 and its recorded source/build hashes. It proves its nominal
isolated path, with simulated Linear/GitHub/model responses; it does not prove
these new fault cases or the new candidate pair.

The earlier ad hoc `/tmp` audit scripts were no longer present at this lot's
start. Their historical hashes are not offered as replayable candidate evidence.
Regression cases belong in the repositories and are rerun for these candidates.
Current source verification:

- Intake `npm run check`: **588 passing tests**, including worker RPC and new
  handoff and presentation regressions; typecheck/build pass.
- Intake `npm run test:postgres`: **237 passing tests** against a fresh private
  PostgreSQL 18 instance, stopped afterward. Seventeen new cases exercise
  comment drift/deletion/identity replacement, retained old bodies, pre-claim
  refusal, reader/publisher separation and lost-status-response combinations.
- Council: **1,431 passing tests, one skipped**, plus **127 Python operations
  tests**. The new composed driver test includes retained `createBody`, a fresh
  admission challenge after resumption, withdrawn-source refusal, a valid first
  plan, restart and lost ACK; ordinary Todo remains covered.
- Independent review found two composed gaps during development: uncertain
  status plus writer revocation, and retained preparation bypassing initial
  source revalidation. Both were corrected and regression-tested. Final source
  review found no remaining P0/P1/P2 within this lot.
- Pinned Fallow 3.23 gates use the exact bases above. No gate configuration or
  dependency was relaxed. Moderate complexity warnings remain informational;
  final local typecheck/static checks pass. Published candidate CI is required
  before merge.

Replay the ordinary repository commands and their isolated database fixture;
no real Linear/provider credentials are needed. Local logs remain under
`artifacts/bounded-corrections/` (Intake) and `.runtime/bounded-corrections/`
(Council). GitHub CI binds the published commits and retains its own artifacts.

Real Q-LR/Q-LW, campaign enrollment, a valid project mandate/budget and the real
pilot remain separate. The HTTPS webhook entry point alone does not satisfy
those prerequisites. Source/build/tests, installed qualification and activation
remain distinct.
