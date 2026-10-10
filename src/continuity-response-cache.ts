import type { PluginDatabaseClient } from "@paperclipai/plugin-sdk";
import { INTAKE_DATABASE_NAMESPACE as ns } from "./intake-state.js";
import { contentDigest } from "./content-digest.js";
import { requirePublication, type ContinuityRequest } from "./continuity-contract.js";

const table = `${ns}.campaign_continuity_responses`;
export function continuityResponseCache(db: PluginDatabaseClient, request: ContinuityRequest) {
  const digest = contentDigest(request), params = [request.binding.companyId,request.challengeId];
  return {
    async get() {
      if (!request.sourceObservationProtocol) return undefined;
      const [row] = await db.query<{ request_sha256: string; response: Record<string, unknown> }>(
        `SELECT request_sha256,response FROM ${table} WHERE company_id=$1 AND challenge_id=$2`, params);
      if (!row) return undefined;
      requirePublication(row.request_sha256 === digest, "continuity_challenge_reused");
      return row.response;
    },
    async save(response: Record<string, unknown>) {
      if (!request.sourceObservationProtocol) return response;
      await db.execute(`INSERT INTO ${table} (company_id,challenge_id,request_sha256,response)
        VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`, [...params,digest,JSON.stringify(response)]);
      const [row] = await db.query<{ request_sha256: string; response: Record<string, unknown> }>(
        `SELECT request_sha256,response FROM ${table} WHERE company_id=$1 AND challenge_id=$2`, params);
      requirePublication(row?.request_sha256 === digest, "continuity_challenge_reused");
      return row.response;
    },
  };
}
