import { z } from "@paperclipai/plugin-sdk";
import { requirePublication } from "./continuity-contract.js";

const pageSchema = z.object({ comments: z.array(z.object({ id: z.uuid(), body: z.string(), issueId: z.uuid().optional() }).passthrough()).max(250),
  hasNextPage: z.boolean(), cursor: z.string().min(1).nullable().optional() }).passthrough();
type Page = z.infer<typeof pageSchema>;
type Comment = { id: string; body: string };

function appendPage(issueId: string, page: Page, comments: Comment[], seen: Set<string>) {
  for (const comment of page.comments) {
    requirePublication(!seen.has(comment.id), "publication_comments_ambiguous");
    requirePublication(!comment.issueId || comment.issueId === issueId, "publication_comments_ambiguous");
    seen.add(comment.id); comments.push({ id: comment.id, body: comment.body });
  }
}

function nextCursor(page: Page, cursors: Set<string>) {
  requirePublication(page.cursor, "publication_comments_incomplete");
  requirePublication([page.comments.length > 0, !cursors.has(page.cursor)].every(Boolean), "publication_comments_incomplete");
  cursors.add(page.cursor);
  return page.cursor;
}

export async function readPublicationComments(issueId: string, maxPages: number,
  readPage: (cursor: string | undefined) => Promise<unknown>) {
  const comments: Comment[] = [], seen = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  for (let number = 0; number < maxPages; number++) {
    const parsed = pageSchema.safeParse(await readPage(cursor));
    requirePublication(parsed.success, "publication_comments_unqualified");
    appendPage(issueId, parsed.data, comments, seen);
    if (!parsed.data.hasNextPage) return comments;
    cursor = nextCursor(parsed.data, cursors);
  }
  throw new Error("publication_comments_incomplete");
}
