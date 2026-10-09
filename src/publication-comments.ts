import { z } from "@paperclipai/plugin-sdk";
import { contentDigest } from "./content-digest.js";
import { publicationText, emptyPresentation } from "./publication-text.js";
import { requirePublication } from "./continuity-contract.js";

const pageSchema = z.object({ comments: z.array(z.object({ id: z.uuid(), body: z.string(), url: z.url().optional(), issueId: z.uuid().optional() }).passthrough()).max(250),
  hasNextPage: z.boolean(), cursor: z.string().min(1).nullable().optional() }).passthrough();
type Page = z.infer<typeof pageSchema>;
type Comment = { id: string; body: string; url?: string };

function appendPage(issueId: string, page: Page, comments: Comment[], seen: Set<string>) {
  for (const comment of page.comments) {
    requirePublication(!seen.has(comment.id), "publication_comments_ambiguous");
    requirePublication(!comment.issueId || comment.issueId === issueId, "publication_comments_ambiguous");
    if (comment.url) {
      const url = new URL(comment.url);
      requirePublication(url.protocol === "https:" && ![url.username, url.password].some(Boolean), "publication_comments_unqualified");
    }
    seen.add(comment.id); comments.push({ id: comment.id, body: comment.body, ...(comment.url ? { url: comment.url } : {}) });
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

/** Presentation is derived from the retained source and bound Council payload, never live metadata. */
export function renderPublicationComment(payload: import("./continuity-contract.js").PublicationPayload,
  intentId: string, context = emptyPresentation) {
  const marker = `<!-- paperclip-linear:${intentId}:${contentDigest(payload)} -->`;
  const body = `${publicationText(payload, context)}\n\n${marker}`;
  requirePublication(Buffer.byteLength(body) <= 24_000, "publication_content_bound");
  return body;
}
