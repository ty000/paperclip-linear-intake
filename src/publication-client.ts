import { createHash } from "node:crypto";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { openGateway, type GatewayReadGuard } from "./gateway.js";
import { unwrapManagedPayload, parseDetail } from "./source-payload.js";
import { parseConfig } from "./config.js";
import { contentDigest } from "./content-digest.js";
import { requirePublication } from "./continuity-contract.js";

import { readPublicationComments } from "./publication-comments.js";

const suffixes = { saveComment: "save-comment", listComments: "list-comments", saveIssue: "save-issue", getIssue: "get-issue" } as const;
const fields = ["uuid", "title", "description", "parentId", "teamId", "projectId", "projectMilestone", "updatedAt", "createdAt",
  "status", "statusType", "stateHistory", "completedAt", "canceledAt", "archivedAt", "relations"];

type GatewaySession = NonNullable<Awaited<ReturnType<typeof openGateway>>>;
type Publisher = NonNullable<GatewaySession["config"]["publisher"]>;

function verifyCatalog(session: GatewaySession, publisher: Publisher) {
  requirePublication(session.config.sourceReader, "publication_disabled");
  const namespace = session.config.sourceReader.tools.getIssue.name.split(":").slice(0,-1).join(":");
  for (const [role, suffix] of Object.entries(suffixes)) {
    const pin = publisher.tools[role as keyof typeof suffixes], tool = session.tools.find(t => t.name === pin.name);
    requirePublication(tool, "publication_catalog_changed");
    requirePublication([pin.name.split(":").at(-1)!.replaceAll("_", "-") === suffix,
      pin.name.split(":").slice(0,-1).join(":") === namespace,
      createHash("sha256").update(JSON.stringify(tool.inputSchema)).digest("hex") === pin.inputSchemaSha256].every(Boolean), "publication_catalog_changed");
  }
}

async function guardPublisherWrite(ctx: PluginContext, companyId: string, guard: GatewayReadGuard, role: keyof typeof suffixes) {
  if (!["saveComment", "saveIssue"].includes(role)) return;
  const current = parseConfig(await ctx.config.get(companyId));
  requirePublication([current.publisher?.enabled, current.councilContinuityEnabled].every(Boolean), "publication_disabled");
  await guard(current);
}

export async function openPublicationClient(ctx: PluginContext, companyId: string, guard: GatewayReadGuard) {
  const session = await openGateway(ctx, companyId, guard, "publication");
  requirePublication(session, "publication_disabled");
  const publisher = session.config.publisher;
  requirePublication(publisher, "publication_disabled");
  verifyCatalog(session, publisher);
  let count = 0;
  const deadline = Date.now() + 120_000;
  async function call(role: keyof typeof suffixes, args: Record<string, unknown>) {
    requirePublication(++count <= 200 && Date.now() <= deadline, "publication_read_bound");
    await guardPublisherWrite(ctx, companyId, guard, role);
    const result = await session!.rpc("tools/call", { name: publisher!.tools[role].name, arguments: args });
    const payload = unwrapManagedPayload(result);
    session!.assertCredentialAbsent(payload);
    requirePublication(Date.now() <= deadline, "publication_read_bound");
    return payload;
  }
  return {
    publisher,
    comments: (issueId: string) => readPublicationComments(issueId, publisher.maxCommentPages,
      cursor => call("listComments", { issueId, limit: publisher.pageSize, orderBy: "createdAt", ...(cursor ? { cursor } : {}) })),
    async issue(issueId: string) {
      const raw = await call("getIssue", { id: issueId, fields });
      const issue = parseDetail(raw);
      requirePublication(issue.uuid === issueId && issue.teamId === session.config.sourceReader!.teamId
        && issue.projectId === session.config.sourceReader!.projectId, "publication_issue_mismatch");
      const { uuid, title, description, parentId, teamId, projectId, relations, archivedAt } = issue;
      const projectMilestone = (raw as Record<string, unknown>).projectMilestone ?? null;
      return { sourceId: uuid, stateId: issue.currentStateId, statusType: issue.statusType, teamId, projectId,
        protectedSha256: contentDigest({ uuid, title, description, parentId, teamId, projectId, relations, projectMilestone, archivedAt }) };
    },
    async comment(issueId: string, body: string) { await call("saveComment", { issueId, body }); },
    async status(issueId: string, stateId: string) { await call("saveIssue", { id: issueId, state: stateId }); },
  };
}
export type PublicationClient = Awaited<ReturnType<typeof openPublicationClient>>;
