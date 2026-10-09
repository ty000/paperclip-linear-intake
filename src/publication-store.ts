import type { PluginDatabaseClient } from "@paperclipai/plugin-sdk";
import { INTAKE_DATABASE_NAMESPACE as ns } from "./intake-state.js";
import { contentDigest } from "./content-digest.js";
import { requirePublication, type ContinuityRequest, type PublicationPayload, type ProofReference } from "./continuity-contract.js";
import type { IntakeRequest } from "./intake-state.js";

export type PublicationEffect = { kind: "comment" | "status"; sourceId: string; body?: string; stateId?: string;
  state: "pending" | "claimed" | "confirmed"; before?: Record<string, unknown>; readback?: Record<string, unknown>; confirmedAt?: string };
export type PublicationRecord = { companyId: string; intentId: string; missionId: string; payloadSha256: string;
  payload: PublicationPayload; effects: PublicationEffect[]; version: number; receipt: ProofReference | null };
const columns = `company_id AS "companyId", intent_id AS "intentId", mission_id AS "missionId", payload_sha256 AS "payloadSha256", payload, effects, version, receipt`;
const publications = `${ns}.campaign_publications`, bindings = `${ns}.campaign_publication_bindings`;

export function createPublicationStore(db: PluginDatabaseClient) {
  requirePublication(db.namespace === ns, "publication_namespace_mismatch");
  const get = async (companyId: string, intentId: string) => (await db.query<PublicationRecord>(
    `SELECT ${columns} FROM ${publications} WHERE company_id = $1 AND intent_id = $2`, [companyId, intentId]))[0];
  return {
    get,
    async retainedRequest(request: ContinuityRequest) {
      const [row] = await db.query<{ binding_sha256: string; source_sha256: string; retained_request: IntakeRequest }>(
        `SELECT binding_sha256, source_sha256, retained_request FROM ${bindings} WHERE company_id=$1 AND mission_id=$2`, [request.binding.companyId,request.binding.missionId]);
      if (!row) return undefined;
      requirePublication(row.binding_sha256 === contentDigest(request.binding) && row.source_sha256 === request.sourceSha256, "publication_campaign_changed");
      return row.retained_request;
    },
    async bind(request: ContinuityRequest, retainedRequest: IntakeRequest) {
      const b = request.binding, digest = contentDigest(b);
      await db.execute(`INSERT INTO ${bindings} (company_id, mission_id, binding_sha256, binding, source_sha256, retained_request)
        VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb) ON CONFLICT DO NOTHING`, [b.companyId,b.missionId,digest,JSON.stringify(b),request.sourceSha256,JSON.stringify(retainedRequest)]);
      const [row] = await db.query<{ binding_sha256: string; source_sha256: string }>(
        `SELECT binding_sha256, source_sha256 FROM ${bindings} WHERE company_id = $1 AND mission_id = $2`, [b.companyId,b.missionId]);
      requirePublication(row?.binding_sha256 === digest && row.source_sha256 === request.sourceSha256, "publication_campaign_changed");
    },
    async list(companyId: string, missionId: string) {
      const rows = await db.query<PublicationRecord>(`SELECT ${columns} FROM ${publications} WHERE company_id = $1 AND mission_id = $2 ORDER BY created_at, intent_id LIMIT 65`, [companyId,missionId]);
      requirePublication(rows.length <= 64, "publication_journal_bound");
      return rows;
    },
    async ensure(request: ContinuityRequest, intentId: string, payload: PublicationPayload, effects: PublicationEffect[]) {
      const digest = contentDigest(payload), b = request.binding;
      await db.execute(`INSERT INTO ${publications} (company_id,intent_id,mission_id,payload_sha256,payload,effects)
        SELECT $1,$2,$3,$4,$5::jsonb,$6::jsonb WHERE EXISTS (SELECT 1 FROM ${bindings} WHERE company_id=$1 AND mission_id=$3 AND binding_sha256=$7)
        ON CONFLICT DO NOTHING`, [b.companyId,intentId,b.missionId,digest,JSON.stringify(payload),JSON.stringify(effects),contentDigest(b)]);
      const row = await get(b.companyId,intentId);
      requirePublication(row && row.payloadSha256 === digest && row.missionId === b.missionId, "publication_intent_changed");
      return row;
    },
    async save(row: PublicationRecord, effects: PublicationEffect[], receipt: ProofReference | null = row.receipt) {
      const result = await db.execute(`UPDATE ${publications} SET effects=$1::jsonb, receipt=$2::jsonb, version=version+1
        WHERE company_id=$3 AND intent_id=$4 AND version=$5 AND payload_sha256=$6`,
      [JSON.stringify(effects),JSON.stringify(receipt),row.companyId,row.intentId,row.version,row.payloadSha256]);
      requirePublication(result.rowCount === 1, "publication_concurrent_change");
      return { ...row, effects, receipt, version: Number(row.version) + 1 };
    },
  };
}
export type PublicationStore = ReturnType<typeof createPublicationStore>;
