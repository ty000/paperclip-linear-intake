import { z } from "@paperclipai/plugin-sdk";

const timestamp = z.iso.datetime({ offset: true });
const reference = z.string().min(1);
const stateSchema = z.object({ id: z.uuid(), name: reference, type: reference }).passthrough();
const historySchema = z.object({
  state: stateSchema, startedAt: timestamp, endedAt: timestamp.nullable(),
}).passthrough();
const relationSchema = z.object({ id: reference, title: z.string().optional() }).passthrough();
const relationsSchema = z.object({
  blocks: z.array(relationSchema), blockedBy: z.array(relationSchema),
  relatedTo: z.array(relationSchema), duplicateOf: relationSchema.nullable(),
}).passthrough();
const issueIdentity = {
  id: reference, uuid: z.uuid(), parentId: reference.nullable(),
  teamId: z.uuid(), projectId: z.uuid().nullable(), updatedAt: timestamp,
};
const detailSchema = z.object({
  ...issueIdentity, title: z.string(), description: z.string().nullable(),
  status: reference, statusType: reference, createdAt: timestamp,
  completedAt: timestamp.nullable(), canceledAt: timestamp.nullable(), archivedAt: timestamp.nullable(),
  relations: relationsSchema, stateHistory: z.array(historySchema),
}).passthrough();
const pageSchema = z.object({
  issues: z.array(z.object(issueIdentity).passthrough()), hasNextPage: z.boolean(),
  cursor: z.string().min(1).nullable().optional(),
}).passthrough();
const managedSchema = z.object({
  isError: z.literal(false),
  structuredContent: z.object({
    isError: z.literal(false), structuredContent: z.null(),
    content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })]),
  }),
});
const statusesSchema = z.array(stateSchema);
const teamSchema = z.object({ id: z.uuid() }).passthrough();
const projectSchema = z.object({ uuid: z.uuid() }).passthrough();

function validated<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  // Zod diagnostics and JSON parser errors can quote private source content.
  if (!result.success) throw new Error("source_payload_invalid");
  return result.data;
}

export function unwrapManagedPayload(result: unknown): unknown {
  const outer = validated(managedSchema, result);
  try { return JSON.parse(outer.structuredContent.content[0].text); }
  catch { throw new Error("source_payload_invalid"); }
}

function uniqueCurrentState(history: z.infer<typeof historySchema>[]) {
  const open = history.filter(interval => interval.endedAt === null);
  if (open.length !== 1) throw new Error("source_state_history_invalid");
  return open[0]!.state;
}

function requireMatchingState(detail: z.infer<typeof detailSchema>, state: z.infer<typeof stateSchema>) {
  if (state.name !== detail.status || state.type !== detail.statusType) {
    throw new Error("source_state_history_invalid");
  }
}

export function parseDetail(raw: unknown) {
  const detail = validated(detailSchema, raw);
  const state = uniqueCurrentState(detail.stateHistory);
  requireMatchingState(detail, state);
  return { ...detail, currentStateId: state.id };
}

function requireContinuation(page: z.infer<typeof pageSchema>) {
  if (!page.hasNextPage) return;
  if (!page.cursor) throw new Error("source_page_incomplete");
  if (page.issues.length === 0) throw new Error("source_page_incomplete");
}

export function parsePage(raw: unknown) {
  const page = validated(pageSchema, raw);
  // Terminal cursor variants are accepted conservatively, not natively qualified:
  // hasNextPage:false may carry an absent, null, or nonempty cursor.
  requireContinuation(page);
  return page;
}

export function parseStatuses(raw: unknown) {
  return validated(statusesSchema, raw);
}

export function parseTeam(raw: unknown) {
  return validated(teamSchema, raw);
}

export function parseProject(raw: unknown) {
  return validated(projectSchema, raw);
}
