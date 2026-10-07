# Lot 1 continuation — complete family reader

Base: `f85ab5d19dcdbcf1146003ea9945dfb3a9c59925` (merged PR 2).
Source package: **0.1.4**, SDK/shared **2026.1005.0**. This is still Lot 1.
Recipe runs **0.1.3** with intake disabled. Native leaf reads passed; a stable
parent family remains unqualified after two native transport failures near the deadline. The 0.1.4
call-mode continuation is not yet installed. Lots 2 and 3 have not started.

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
| L1-A | Pinned SDK package and disabled manifest/worker; portable checks recorded by CI. |
| L1-B | Six native input contracts, workspace/detail outputs and real continuation/terminal pages observed. Stable complete-parent result still pending. PARTIAL. |
| L1-C | Synthetic complete families and native leaf reads PASS. Two parent attempts failed closed on native transport errors. PARTIAL. |
| L1-D | PASS for actual 0.1.3 native reader calls, without an implementation model or operator credential in the plugin. REST continuation still needs qualification. |
| L1-E | PASS: native company/plugin secret resolution during 0.1.3 reader execution; encoded echo rejection covered by synthetic tests. |
| L1-F | Existing transport limits retained; repeated-read consistency limits explicit. No GraphQL fallback or new authentication added. |
| L1-G | `npm run check`, native Fallow against the base, package inspection and exact-candidate CI are required for publication. |

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
verdict. **L1 remains partial and Lot 2 remains closed.**

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
must succeed on a reviewed candidate before the parent gate can close.

The synthetic REST checks exercise a real local HTTP server: exact path/header,
all redirect statuses, declared and streamed response-size limits, absolute
deadline, proxy-environment isolation, response/tool identity and nested error
envelopes. Host HTTP uses the published SDK harness. Independent review checked
the native route's authentication and policy contract against the host source;
that source review does not establish a successful native REST family read.
