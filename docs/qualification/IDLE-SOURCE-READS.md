# Idle source reads — 0.6.5

An observation request without publications used to collect the complete source
twice before an empty publication loop, then twice again afterward. There is no
intervening send in that case. Keep the first consistent double observation and
omit the redundant final one only when `request.publications` is empty.

Council owns the frequency of observation requests. Intake owns Linear reads,
write guards and effect readback. The wire protocol, two-minute observation
validity, source digest, SQL journal and effect identities are unchanged. An
observation never restarts a paused campaign on its own.

| Repository | Base | Change |
| --- | --- | --- |
| Intake | `e16fae4ab100b5f0a293f6dfbe048704fe577cb8`, 0.6.4 | Skip the extra observation for an empty publication request; 0.6.5. |
| Council | `d8c2e5663637e00dd9264fbd6d9c11127ff2a9f5`, 0.7.46 | Separate request-cadence correction, owned by Council. |

Paperclip core/SDK, webhook scope, runtime configuration, campaign control and
provider execution are outside this source lot. No cache, migration, additional
scheduler or configuration option is introduced.

## Qualification

The four-ticket fixture in
[`publication-source-reads.test.mjs`](../../test/postgres/publication-source-reads.test.mjs)
uses one project inventory page: 12 read calls per complete collection, 24 per
double observation. MCP initialization/catalogue and native Paperclip requests
are excluded from these counts.

- Running, paused and cancelled requests without publications: **48 → 24 source
  calls**, no publisher reads or writes when the journal has no claimed effect.
- A later request reads the source again and rejects a changed description;
  no previous positive verdict is cached or given a longer validity.
- A restarted worker with an empty request still reconciles a lost status
  response first. It confirms the original effect, then reads its expected
  source state: 24 source calls, one targeted status read, no new write and no
  acknowledgement of an unrequested publication.
- Nonempty requests retain the existing initial/final observations and all
  pre-send, terminal-permission and comment-readback gates. Existing publication
  call counts and concurrency/uncertainty tests remain unchanged.

Local validation: `npm run check` (629 tests), `npm run test:postgres` (261 tests
in a new disposable PostgreSQL 18.1 cluster), `npm run test:package` and the
pinned Fallow 3.23.0 diff gate pass. Replay the database setup described in
[publication source reads](PUBLICATION-SOURCE-READS.md).

These are source, package and isolated SQL/fixture results. They do not prove
installed request frequency, real Linear availability or resumed pilot execution.
