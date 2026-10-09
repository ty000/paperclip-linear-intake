import { createHash } from "node:crypto";
import { z, type PluginContext } from "@paperclipai/plugin-sdk";
import { openGateway, type GatewayReadGuard } from "./gateway.js";
import { unwrapManagedPayload, parseDetail } from "./source-payload.js";
import { contentDigest } from "./content-digest.js";
import { requirePublication } from "./continuity-contract.js";

const suffixes = { saveComment: "save-comment", listComments: "list-comments", saveIssue: "save-issue", getIssue: "get-issue" } as const;
const commentPageSchema = z.object({ comments: z.array(z.object({ id: z.uuid(), body: z.string(), issueId: z.uuid().optional() }).passthrough()).max(250),
  hasNextPage: z.boolean(), cursor: z.string().min(1).nullable().optional() }).passthrough();
const fields = ["uuid", "title", "description", "parentId", "teamId", "projectId", "projectMilestone", "updatedAt", "createdAt",
  "status", "statusType", "stateHistory", "completedAt", "canceledAt", "archivedAt", "relations"];

export async function openPublicationClient(ctx: PluginContext, companyId: string, guard: GatewayReadGuard) {
  const session = await openGateway(ctx, companyId, guard, "publication"), publisher = session?.config.publisher;
  requirePublication(session && publisher && session.config.sourceReader, "publication_disabled");
  const namespace = session.config.sourceReader.tools.getIssue.name.split(":").slice(0,-1).join(":");
  for (const [role, suffix] of Object.entries(suffixes)) {
    const pin = publisher.tools[role as keyof typeof suffixes], tool = session.tools.find(t => t.name === pin.name);
    requirePublication(tool && pin.name.split(":").at(-1)!.replaceAll("_", "-") === suffix
      && pin.name.split(":").slice(0,-1).join(":") === namespace
      && createHash("sha256").update(JSON.stringify(tool.inputSchema)).digest("hex") === pin.inputSchemaSha256, "publication_catalog_changed");
  }
  let count = 0;
  const deadline = Date.now() + 120_000;
  async function call(role: keyof typeof suffixes, args: Record<string, unknown>) {
    requirePublication(++count <= 200 && Date.now() <= deadline, "publication_read_bound");
    const result = await session!.rpc("tools/call", { name: publisher!.tools[role].name, arguments: args });
    const payload = unwrapManagedPayload(result);
    session!.assertCredentialAbsent(payload);
    requirePublication(Date.now() <= deadline, "publication_read_bound");
    return payload;
  }
  return {
    publisher,
    async comments(issueId: string) {
      const comments: Array<{ id: string; body: string }> = [], seen = new Set<string>(), cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < publisher.maxCommentPages; page++) {
        const parsed = commentPageSchema.safeParse(await call("listComments", { issueId, limit: publisher.pageSize, orderBy: "createdAt", ...(cursor ? { cursor } : {}) }));
        requirePublication(parsed.success, "publication_comments_unqualified");
        for (const comment of parsed.data.comments) {
          requirePublication(!seen.has(comment.id) && (!comment.issueId || comment.issueId === issueId), "publication_comments_ambiguous");
          seen.add(comment.id); comments.push({ id: comment.id, body: comment.body });
        }
        if (!parsed.data.hasNextPage) return comments;
        requirePublication(parsed.data.cursor && parsed.data.comments.length && !cursors.has(parsed.data.cursor), "publication_comments_incomplete");
        cursor = parsed.data.cursor; cursors.add(cursor);
      }
      throw new Error("publication_comments_incomplete");
    },
    async issue(issueId: string) {
      const raw = await call("getIssue", { id: issueId, fields });
      const issue = parseDetail(raw);
      requirePublication(issue.uuid === issueId, "publication_issue_mismatch");
      const { uuid, title, description, parentId, teamId, projectId, relations, archivedAt } = issue;
      const projectMilestone = (raw as Record<string, unknown>).projectMilestone ?? null;
      return { sourceId: uuid, stateId: issue.currentStateId, teamId, projectId,
        protectedSha256: contentDigest({ uuid, title, description, parentId, teamId, projectId, relations, projectMilestone, archivedAt }) };
    },
    async comment(issueId: string, body: string) { await call("saveComment", { issueId, body }); },
    async status(issueId: string, stateId: string) { await call("saveIssue", { id: issueId, state: stateId }); },
  };
}
export type PublicationClient = Awaited<ReturnType<typeof openPublicationClient>>;
