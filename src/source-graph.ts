import type { parseDetail } from "./source-payload.js";
import { SourceReadError } from "./source-client.js";
type Detail = ReturnType<typeof parseDetail>;
type Reference = Detail["relations"]["blockedBy"][number];

function references(issues: Detail[]) {
  const result = new Map<string, Detail>();
  for (const issue of issues) {
    bindReference(result, issue.id, issue);
    bindReference(result, issue.uuid, issue);
  }
  return result;
}

function bindReference(refs: Map<string, Detail>, key: string, issue: Detail) {
  const previous = refs.get(key);
  if (previous && previous.uuid !== issue.uuid) throw new SourceReadError("source_reference_ambiguous");
  refs.set(key, issue);
}

function hasReference(refs: Reference[], issue: Detail) {
  return refs.some(ref => [issue.id, issue.uuid].includes(ref.id));
}

function verifyInverse(issue: Detail, blocker: Detail) {
  if (!hasReference(blocker.relations.blocks, issue)) throw new SourceReadError("source_relations_inconsistent");
}

function verifyForwardRelations(issue: Detail, refs: Map<string, Detail>) {
  for (const relation of issue.relations.blocks) {
    const blocked = refs.get(relation.id);
    if (blocked && !hasReference(blocked.relations.blockedBy, issue)) throw new SourceReadError("source_relations_inconsistent");
  }
}

function removeResolved(pending: Map<string, Set<string>>, ready: string[]) {
  for (const id of ready) {
    pending.delete(id);
    for (const dependencies of pending.values()) dependencies.delete(id);
  }
}

function cycleAffected(pending: Map<string, Set<string>>) {
  while (pending.size > 0) {
    const ready = [...pending].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id);
    if (ready.length === 0) return [...pending.keys()].sort();
    removeResolved(pending, ready);
  }
  return [];
}

function issueBlockers(issue: Detail, refs: Map<string, Detail>) {
  const internal: string[] = [], external: { blockedIssueId: string; reference: Reference; status: "unresolved" }[] = [];
  for (const reference of issue.relations.blockedBy) {
    const blocker = refs.get(reference.id);
    if (!blocker) { external.push({ blockedIssueId: issue.uuid, reference, status: "unresolved" }); continue; }
    verifyInverse(issue, blocker);
    internal.push(blocker.uuid);
  }
  return { internal, external };
}

export function familyBlockers(issues: Detail[]) {
  const refs = references(issues), pending = new Map<string, Set<string>>();
  const externalBlockers: ReturnType<typeof issueBlockers>["external"] = [];
  for (const issue of issues) {
    verifyForwardRelations(issue, refs);
    const blockers = issueBlockers(issue, refs);
    pending.set(issue.uuid, new Set(blockers.internal));
    externalBlockers.push(...blockers.external);
  }
  // External references are preserved without following them outside the
  // selected subtree. They cannot establish eligibility or authorize imports.
  return { externalBlockers, cycleAffectedIssueIds: cycleAffected(pending) };
}
