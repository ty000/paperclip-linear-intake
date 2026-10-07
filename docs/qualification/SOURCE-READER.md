# Lot 1 continuation — complete family reader

Base: `f85ab5d19dcdbcf1146003ea9945dfb3a9c59925` (merged PR 2).
Package: **0.1.3**, SDK/shared **2026.1005.0**. This is still Lot 1.
Lot 2 and Lot 3 have not started. Native qualification of this reader remains
pending; the historical installed 0.1.2 probe does not prove this implementation.

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

## Remaining native contract checks

The existing [input schemas](native-input-schemas.json) and private native
observations established the five issue/project/team roles. A read-only catalog
preflight additionally observed `get_workspace` with input
`{"type":"object","properties":{}}`; its output schema is absent. The reader's
provisional `{id: UUID}` workspace parser still needs an actual native observation.
No guessed organization ID may be enrolled to work around that check.

The bounded `probe-source` now optionally accepts a pinned `getWorkspace` role.
When enrolled, it adds exactly one argument-free workspace metadata call before
its previous fixed reads. It remains operator-only and reports source coverage
as unqualified. This lets qualification observe organization identity before
binding the family reader, using the same managed authentication.

The recipe preflight observed installed **0.1.2**, ready, intake disabled, both
probe and reader absent, and the dedicated seven-read profile. `get_workspace`
is available in the connection catalog but is not yet permitted by that profile.
The existing gateway client expires **2026-10-08 15:52:39 UTC**. No runtime setting
was changed by this continuation's preflight.

A bounded native qualification still needs:

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
| L1-B | Five observed input contracts plus the catalog-observed workspace input; workspace output and terminal-page semantics still await native qualification. PARTIAL. |
| L1-C | Complete reader implemented; executable synthetic qualification is separate from native source completeness. Native qualification PENDING. |
| L1-D | Historical native probe used the managed gateway without an implementation model or operator credential inside the plugin. New reader native path PENDING. |
| L1-E | Native secret reference resolution preserved; synthetic checks cover encoded credential echo rejection. New native receipt PENDING. |
| L1-F | Existing transport limits retained; repeated-read consistency limits explicit. No GraphQL fallback or new authentication added. |
| L1-G | `npm run check`, native Fallow against the base, package inspection and exact-candidate CI are required for publication. |

The published CI build artifact binds source SHA, base, lockfile, SDK and built
runtime digests. It never asserts native qualification. Migration prewrite is
not applicable: there is no persistent intake schema or existing-state migration
in this lot. No Lot 2 work starts until every L1 criterion passes.

Local validation: `npm run check` passed **239 tests** (including 52 integrated
family cases and 84 parser cases), typecheck and build. `npm pack --dry-run
--json` passed. Native Fallow **3.23.0** and the static-audit wrapper passed
against the base above with no introduced finding. No audit threshold or
exclusion was relaxed.

Contextual review identified and verified corrections for native bridge-added
parameters, Unicode-escaped credential echoes after nested decoding, and tools
mixed across connection namespaces. No remaining P1/P2 was established in that
review. These are source and synthetic SDK proofs, not native reader execution.
