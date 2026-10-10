import { requirePublication, type ContinuityRequest } from "./continuity-contract.js";
import { contentDigest } from "./content-digest.js";
import type { HandoffSession } from "./council-handoff-ledger.js";
import type { PublicationStore, PublicationRecord } from "./publication-store.js";
import { guardContinuity } from "./continuity-source.js";
import { openPublicationClient } from "./publication-client.js";
import { reconcilePublication, verifyConfirmedComments } from "./publication-engine.js";
import { publicationReceipt } from "./publication-receipt.js";
import { readPublicationDocument } from "./continuity-documents.js";

async function retainedPublications(session: HandoffSession, request: ContinuityRequest, store: PublicationStore) {
  const rows = [];
  for (const reference of request.publications) {
    await readPublicationDocument(session.ctx, request, reference);
    const row = await store.get(request.binding.companyId, reference.intentId);
    if (!row) continue;
    requirePublication([row.missionId === request.binding.missionId, row.payloadSha256 === reference.payloadSha256,
      contentDigest(row.payload.binding) === contentDigest(request.binding)].every(Boolean), "publication_intent_changed");
    rows.push(row);
  }
  return rows;
}

async function readbackPublications(session: HandoffSession, request: ContinuityRequest, store: PublicationStore, rows: PublicationRecord[]) {
  const acknowledgements = [];
  const client = await openPublicationClient(session.ctx, request.binding.companyId, async () => { await guardContinuity(session); });
  for (const row of rows) {
    const observed = await reconcilePublication(store, client, row);
    if (!observed.effects.every(effect => effect.state === "confirmed")) continue;
    await verifyConfirmedComments(store, client, observed);
    acknowledgements.push(await publicationReceipt(session.ctx, store, observed));
  }
  return acknowledgements;
}

/** Read back the original effect identities; never journal, dispatch, or scan a source family. */
export async function readbackContinuity(session: HandoffSession, request: ContinuityRequest, store: PublicationStore) {
  const rows = await retainedPublications(session, request, store);
  const acknowledgements = rows.length ? await readbackPublications(session, request, store, rows) : [];
  return { acknowledgements, diagnostic: await store.heldDiagnostic(request), available: true, terminalClaimRequest: undefined };
}
