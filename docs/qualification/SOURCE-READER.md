# Lot 1 continuation — complete family reader

Base: `f85ab5d19dcdbcf1146003ea9945dfb3a9c59925` (merged PR 2).
Source package: **0.1.4**, SDK/shared **2026.1005.0**. This is still Lot 1.
**L1-A through L1-G PASS.** Recipe runs **0.1.4**, candidate `6747347`, with intake
disabled and no source enrollment. Native leaf reads passed on 0.1.3; the
authorized 0.1.4 REST campaign returned a stable parent plus three children.
The historical failures below remain separate evidence. Lots 2 and 3 have not started.

## Executable behavior

`read-source-family` requires an authenticated SDK user actor, a matching company,
and a root UUID explicitly enrolled in `sourceReader.qualificationRootIssueIds`
(at most two roots). It accepts the root in `issueId`; company/actor parameters
cannot grant authority. The native bridge's company and rendering metadata are
accepted without becoming reader inputs. Configuration remains `enabled:false`.

`sourceReader` binds exact organization, project, team and Todo-state UUIDs and
six tool-name/input-schema hashes: workspace, project, team, states, issue detail
and issue list. All roles must share the native connection namespace; a valid
workspace pin from a different connection is rejected. All pins are checked against the actual gateway catalog before
any source call. Defaults bound a family to 50 issues, 10 pages per parent,
50 identities per page, 250 source requests and 60 seconds. Transport limits
also apply; the final serialized snapshot must fit within 2 MiB.

The reader obtains explicit detail fields, including full `description`, `title`,
`relations` and `stateHistory`. It traverses children using only `parentId`,
following each continuation cursor to a terminal page. It includes archived,
completed and canceled descendants. Every returned identity must have the exact
configured project/team; a parent-scoped page outside that boundary fails before
fetching that child's description. No project-wide scan is performed.

Selecting a child preserves its ancestor reference and follows only its own
children. Readable Linear identifiers and UUIDs are distinct aliases. Internal
blocking edges require consistent inverse relations; external blocker references
are preserved as unresolved and are never followed. Cycles and their dependent
issues appear in `cycleAffectedIssueIds`. Neither those results nor a successful
read grant eligibility, import tasks, write plugin state or wake an agent.

Each detail and each parent inventory is read again, followed by metadata and
configuration validation. Observed changes reject the result. This is optimistic
consistency by repeated reads, **not an atomic Linear snapshot**: a change after
an object's final read remains possible. Future admission must revalidate source
eligibility. A snapshot preserves the original fields and includes a digest,
catalog digest, child inventories, exact current-state IDs and root Todo/archive
flags. A root outside Todo may be observed but is explicitly marked as such.

Both managed MCP error envelopes must indicate success. Malformed JSON, absent
required fields, non-terminal empty pages, repeated cursors, scope conflicts,
missing state history, exceeded bounds and observed revision changes fail closed.
Decoded provider content is checked again for an echoed gateway secret; errors
returned to the operator contain fixed local codes only.

## Native contracts and qualification procedure

The existing [input schemas](native-input-schemas.json) and private native
observations established the five issue/project/team roles. A read-only catalog
preflight additionally observed `get_workspace` with input
`{"type":"object","properties":{}}`; its output schema is absent. The authorized native observation subsequently confirmed `{id: UUID,name,url}`.
The observed ID, not a guessed organization, was enrolled for the family reads.

The bounded `probe-source` now optionally accepts a pinned `getWorkspace` role.
When enrolled, it adds exactly one argument-free workspace metadata call before
its previous fixed reads. It remains operator-only and reports source coverage
as unqualified. This lets qualification observe organization identity before
binding the family reader, using the same managed authentication.

The initial readonly preflight found 0.1.2 and the seven-read profile. The
authorized campaign below upgraded the same plugin and added `get_workspace`.
The existing gateway client expires **2026-10-08 15:52:39 UTC**.

The authorized native qualification used this sequence:

1. Add only the observed `get_workspace` read entry to the existing dedicated
   profile; keep default deny and the same gateway/client/secret reference.
2. Install the reviewed 0.1.3 package under the existing plugin identity, with
   intake disabled. Preserve frozen prior packages and read back version/config.
3. Observe workspace metadata through the pinned native probe; verify its shape,
   organization identity and the already authorized Content Assistant scope.
4. Enroll only the two previously approved sample roots. Execute the reader on
   those subtrees with bounded requests, retain private raw evidence, and publish
   only redacted counts, shapes, hashes and exact candidate/package identity.
5. Remove temporary probe/reader enrollment and verify intake remains disabled.
   Reconcile any uncertain control-plane effect under its original identity.

This procedure creates no Linear webhook, modifies no Linear ticket, launches
no provider model, and does not grant Council admission. An unavailable native
case must remain unqualified; synthetic cases cannot be relabeled native.

## Acceptance ledger

| ID | Evidence and current verdict |
| --- | --- |
| L1-A | PASS: published SDK/shared 2026.1005.0, standalone manifest, worker and disabled default; [exact-candidate CI](https://github.com/ty000/paperclip-linear-intake/actions/runs/37677160128). |
| L1-B | PASS: observed native input contracts, workspace/detail outputs, continuation and terminal pages; [REST campaign](native-rest-qualification.json). |
| L1-C | PASS: two native leaves and one complete parent family; four descriptions, three children, two internal blocking edges, eight unresolved external references; [family summary](native-rest-family-summary.json). |
| L1-D | PASS: 28 native source calls via the plugin and dedicated named gateway, without an implementation-model run or operator credential in the plugin. |
| L1-E | PASS: native company/plugin secret-reference resolution, unchanged dedicated client; actual reader execution plus synthetic decoded-echo rejection. |
| L1-F | PASS: explicit request/family/size limits, optimistic repeated-read consistency and connector description representation documented. No GraphQL fallback or new authentication. |
| L1-G | PASS: typecheck, build, 309 tests, pack, native Fallow 3.23.0 and wrapper; all three CI jobs passed on `6747347`. [Installed runtime readback](native-rest-readback.json) matches that build. |

The published CI build artifact binds source SHA, base, lockfile, SDK and built
runtime digests. It never asserts native qualification. Migration prewrite is
not applicable: there is no persistent intake schema or existing-state migration
in this lot. No Lot 2 work starts until every L1 criterion passes.

Local validation of 0.1.4: `npm run check` passed **309 tests** (including 52 integrated
family cases, 84 parser cases, native REST transport and portable evidence-redaction
cases), typecheck and build. `npm pack --dry-run
--json` passed. Native Fallow **3.23.0** and the static-audit wrapper passed
against the base above with no introduced finding. No audit threshold or
exclusion was relaxed.

Contextual review identified and verified corrections for native bridge-added
parameters, Unicode-escaped credential echoes after nested decoding, and tools
mixed across connection namespaces. No remaining P1/P2 was established in that
review. These are source and synthetic SDK proofs, not native reader execution.

## Authorized native campaign on 0.1.3

The operator approved installation of candidate
`140e9ed70787be1377f34de42a9eb21efe746c3d`, the single additional workspace read
entry, the two previously enrolled roots, and temporary enrollment cleanup.
An initial install-API request left the existing plugin and configuration
unchanged; readback reconciled it before using the native upgrade API with the
same plugin UUID. The active path was staged with a verified copy and the old
package preserved. All ten installed runtime files match the CI build digests.

The workspace probe observed `{id,name,url}`. Its first call timed out and made
the managed connection unhealthy; a subsequent action stopped at catalog
validation without a provider call. The native health check restored the
connection, and one resumed provider read succeeded. No credential was replaced,
no profile was widened beyond `get_workspace`, and no timeout was changed.

Two native leaf reads then succeeded, with **12 source requests each**. Each
returned one issue, a terminal empty child inventory and three unresolved
external blockers. Descriptions contain **5,452** and **5,641** characters.
Separate authorized `get_issue` reads through the Codex connector matched the
UUID, description, title, team/project, ancestry, revision, relations and state
history. This comparison supplements the actual plugin-to-gateway execution;
it does not substitute for that native path. See the
[redacted leaf summary](native-reader-leaves-summary.json).

The operator separately authorized parent **PEZ-647** and its Content Assistant
subtree, with at most 50 issues and pages of one child. The real managed
connector returned three one-child pages (`true`, `true`, then `false` for
`hasNextPage`) and terminal empty child inventories. A detail read failed during
revalidation. After a successful native health check, a single retry failed on
an inventory read. Both failures occurred near the ten-second native deadline
with `mcp_remote_fetch_failed`; neither returned a family result. This generic
code does not establish a timeout cause. A larger supported call budget is a
qualification hypothesis, not an already proven remedy. These attempts
are [recorded separately](native-parent-failures.json), not promoted to a pass.

All temporary probe/reader enrollment was removed, the original disabled config
was read back exactly, and native connection health was restored. The
[final readback](native-reader-readback.json) verifies ready 0.1.3, default-deny
eight-read profile, twelve-tool catalog, no probe/reader enrollment and runtime
digests. The two-leaf campaign flag in the private driver is not a global L1
verdict. **At the end of that 0.1.3 campaign, L1 remained partial and Lot 2 stayed closed.**

Replay portable redaction without any network access:

```bash
node scripts/qualification/summarize-native-family.mjs \
  <private-workspace-observation.json> <private-family-0.json> <private-family-1.json>
```

Replay catalog/config/installed-byte readback (no source tool call):

```bash
node --import <host-tsx-loader> scripts/qualification/native-catalog-readback.mjs \
  <host-repo> <private-identity-receipt.json> family-reader
```

## Native timeout continuation

The readonly host reference `61b3fd57a695614dc4a37e2303f426a34a9795cf`
exposes `POST /api/tool-gateway/tools/call` with an explicit `timeoutMs`.
The MCP route omits this option and uses a ten-second default. The REST route
uses `x-paperclip-tool-gateway-token`; bearer Authorization belongs to the MCP
route and must not be sent on this REST path. The host resolves the same named
gateway client to its company, profile and allowed actions, and applies the same
policy before the remote call. The host permits at most sixty seconds; the
plugin's explicit `native_rest` mode uses 20 seconds by default, with a maximum
of 30 seconds and a local response allowance of two seconds. Source anchors:
`server/src/routes/tool-gateway.ts:39,167,561`,
`server/src/services/tool-gateway.ts:663,1801,6875,9690,10411,10566`.

The 0.1.4 implementation adds this explicit plugin-only call mode through the existing native
identity, with MCP initialization/catalog checks first and the REST endpoint
fixed to the same origin. It introduces no GraphQL fallback, new authentication,
operator token in the plugin or Paperclip core change. Its native qualification
was then performed on the separately approved candidate below.

The synthetic REST checks exercise a real local HTTP server: exact path/header,
all redirect statuses, declared and streamed response-size limits, absolute
deadline, proxy-environment isolation, response/tool identity and nested error
envelopes. Host HTTP uses the published SDK harness. Independent review checked
the native route's authentication and policy contract against the host source;
that source review does not establish a successful native REST family read.

## Successful native REST campaign on 0.1.4

The operator approved candidate `6747347b7b2b6e4d0854effc4d10481d73b5aa6d`,
installation under the existing plugin identity, one bounded PEZ-647 subtree read
and enrollment cleanup. Three exact-candidate CI jobs passed. All eleven frozen
runtime files and the lockfile were compared with the downloaded CI artifact
before staging the update; the previous active 0.1.3 package was preserved.
No gateway profile, credential or host source changed.

The reader used native REST with a 30-second per-call timeout, 120-second reader
budget, at most 50 issues and pages of one child. It returned **four issues in
28 completed source calls**, with no failed native call. Native activity records
show the parent's `hasNextPage` sequence **true, true, false**, repeated on the
second inventory pass, and empty terminal child inventories in both passes.
The family contains two internal blocking edges and eight unresolved external
blocker references. Description lengths are 7,631, 5,641, 5,200 and 5,452
characters. The [campaign receipt](native-rest-qualification.json) and
[portable family summary](native-rest-family-summary.json) retain hashes/counts
without ticket bodies or credentials.

A separate [connector comparison](native-rest-parent-comparison.json) matched
16 observed fields per issue and the parent's complete three-child inventory.
The parent reference was refreshed because its revision changed between the
earlier and current campaigns. The three child descriptions match byte for byte.
The parent description differs only in three issue mentions: the Codex connector
returns `<issue>` tags, while the managed native path returns Markdown links.
Converting precisely those tags to links makes the descriptions identical; the
reader preserves the native source as received. This supplementary comparison
does not replace the actual plugin execution.

Afterward, the exact original disabled configuration was restored, with no probe
or reader enrollment. The final [native readback](native-rest-readback.json)
confirms ready 0.1.4, the same default-deny eight-read profile and twelve-tool
catalog, and all runtime digests matching the qualified CI build. Native
connection health is `ok`; every journaled effect has a known response/readback.
An independent contextual review checks the final criterion-to-proof mapping.

The selected root was outside Todo and the returned flag correctly records it.
This qualification proves source access and completeness, not request acceptance,
import or Council admission. No webhook, ticket modification, implementation
agent or provider-model run occurred. The successful REST campaign does not
establish the cause of the earlier generic MCP failures. Read consistency remains
optimistic and credentials retain their recorded expiry. Lot 2 may now begin;
Lot 3 still depends on Lot 2's own qualification.
