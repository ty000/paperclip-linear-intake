# Publication source-read reduction — 0.6.3 candidate

Scope: remove the redundant complete source observation before claiming a new
ordinary publication effect. The claim still checks native authority, current
configuration, preparation/readiness, the durable source-hold gate and challenge
expiry. Immediately before
its only send, the effect still runs those checks and the complete double source
observation. Initial and final observations, readbacks, durable intent identities
and uncertainty rules are unchanged. There is no cache, retry, deadline change,
migration or partial-acknowledgement change.

## Measured calls

Both versions used the same synthetic campaign: four tickets (campaign, parent,
two leaves), source page size 10 and one project inventory page. One complete
collection takes 12 read-tool calls; one consistent source observation contains
two collections, hence 24 calls. Counts exclude MCP initialization/catalogue
requests and native Paperclip reads. Publisher totals include writes.

Baseline source: `a1adfd915f187586d555e9a36a014d7d894c90ba` (0.6.2).
Baseline measurements were taken before the source change, with the same
representative fixture. Candidate expectations are executable in
[`publication-source-reads.test.mjs`](../../test/postgres/publication-source-reads.test.mjs).

| Scenario | Baseline source calls | Candidate source calls | Publisher reads + writes | Total before → after |
| --- | ---: | ---: | ---: | ---: |
| One progress comment | 96 | 72 | 3 + 1 | 100 → 76 |
| Progress comment + one status | 144 | 96 | 6 + 2 | 152 → 104 |
| Scoped blocker comment | 48 | 48 | 5 + 1 | 54 → 54 |
| Closure permission request, no grant | 72 | 72 | 0 + 0 | 72 → 72 |

The candidate saves exactly 24 source calls per newly dispatched ordinary
effect. This bounded fixture does not establish real gateway latency, service
reliability or a universal count for larger/paginated campaigns.

## Acceptance and replay

| Criterion | Evidence |
| --- | --- |
| A1: measured reduction | Counts at each durable claim and send prove initial, per-send and final double observations; table above. |
| A2: source drift after claim | Changed description prevents progress and granted-closure sends; restoration retains the original claimed effect. |
| A3: current authority and readiness | Before-claim and after-claim revocations cover activation, configuration, publisher enablement, prepared plan, readiness revision, expiry and the durable source-hold gate. |
| A4: uncertainty and identity | Drift recovery preserves effect/payload identity; existing lost-response, absent-effect, restart and SQL concurrency tests remain active. |
| A5: control and closure | Scoped root-project revalidation, unchanged control call counts, terminal grant gate and required historical comment readbacks. |
| A6: isolated qualification | Typecheck, package tests and PostgreSQL tests use synthetic host/gateway services; no real Linear or provider calls. |

Run ordinary checks and package smoke from this checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:package
```

For storage/publication qualification, provision a **new disposable PostgreSQL
18.1 cluster** with database and user both `intake_test`, then set
`INTAKE_TEST_DATABASE_URL` to that isolated cluster. The helper drops/recreates
its plugin schema; never use a recipe or production database.

```sh
npm run test:postgres
```

This includes the new counting and revocation scenarios plus existing
publication, continuity, readback and restart coverage. Local qualification used
PostgreSQL 18.1, Node 24.20.0 and locked dependencies. Source/isolated success is
not evidence of installation, resumed campaign execution or real publication.
