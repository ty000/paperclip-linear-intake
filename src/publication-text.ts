import type { PublicationPayload } from "./continuity-contract.js";

export type PublicationPresentation = { sources: Array<{ sourceId: string; label: string }>;
  references: Array<{ label: string; url: string; version?: string; sha256?: string }>;
  sourceSha256?: string; campaignUrl?: string };
export const emptyPresentation: PublicationPresentation = { sources: [], references: [] };
const kinds = { progress: "Progression", blocker: "Blocage", question: "Question", decision: "Décision", closure: "Bilan", cancellation: "Annulation" };
const statuses: Record<string, string> = { started: "En cours", completed: "Terminé", cancelled: "Annulé", running: "En cours",
  pause_requested: "Pause demandée", paused: "En pause", cancel_requested: "Annulation demandée", waiting: "En attente",
  progressed: "En cours", blocked: "Décision requise", complete: "Parcours autorisé terminé", satisfied: "Satisfait",
  unsatisfied: "Non satisfait", unknown: "À vérifier", approved: "Approuvé" };
function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown) { return typeof value === "string" ? value.trim().slice(0, 4000) : ""; }
function label(value: unknown) { return text(value).replace(/[\r\n]+/g, " ").replace(/[[\]<>]/g, "").slice(0, 400); }
function status(value: unknown) { return statuses[text(value)] ?? "État en cours de vérification"; }
function https(value: unknown) {
  try {
    const url = new URL(text(value));
    return [url.protocol === "https:", !url.username, !url.password].every(Boolean) ? url.href : "";
  } catch { return ""; }
}
function sourceLabel(id: string, context: PublicationPresentation) {
  return context.sources.find(source => source.sourceId === id)?.label ?? "Élément de campagne";
}
function statusLines(payload: PublicationPayload, context: PublicationPresentation) {
  return (payload.statusUpdates ?? []).map(update => `- ${label(sourceLabel(update.sourceId, context))} : ${status(update.state)}`);
}
function campaignReview(payload: PublicationPayload) { return record(payload.campaignClosure ?? payload.campaignReview); }
function plannedDeliveries(payload: PublicationPayload, context: PublicationPresentation) {
  const leaves = list(record(payload.campaignPlan).leaves);
  if (!leaves.length) return [];
  return ["### Ordre des livraisons", ...leaves.map((leaf, index) =>
    `${index + 1}. ${label(sourceLabel(text(record(leaf).sourceId), context))}`),
    "Chaque livraison attend la revue, la fusion, la vérification et la publication confirmées de la précédente."];
}
function progress(payload: PublicationPayload) {
  const observation = record(payload.observation), campaign = record(payload.campaign);
  const lines = [text(payload.text), text(payload.message), text(payload.reason), text(observation.nextAction)].filter(Boolean);
  if (payload.control) lines.push(`**État :** ${status(payload.control)}`);
  if (observation.state) lines.push(`**Suivi :** ${status(observation.state)}`);
  if (Array.isArray(campaign.memberMissionIds)) lines.push(`${list(campaign.closedMissionIds).length} réalisation(s) clôturée(s) sur ${campaign.memberMissionIds.length} mission(s) commencée(s).`);
  return lines;
}
function links(result: unknown) {
  const r = record(result);
  return [r.pullRequestUrl, r.prUrl, r.url, record(r.pullRequest).url, record(r.publication).pullRequestUrl]
    .map(https).filter(Boolean).map(url => `- [Pull request](${url})`);
}
function deliveryLinks(payload: PublicationPayload) {
  const delivery = record(payload.campaignDelivery), closure = campaignReview(payload);
  return [...new Set([...links(payload.result), ...links(delivery.result),
    ...list(closure.results).flatMap(result => links(record(result).integratedResult))])];
}
function exactReferences(title: string, values: unknown[]) {
  const refs = values.map(text).filter(Boolean).map(value => `\`${value.replace(/`/g, "\\`")}\``);
  return refs.length ? `  ${title} : ${refs.join(", ")}` : "";
}
function coverageLine(value: unknown, index: number, labels: Map<unknown, unknown>) {
  const row = record(value), verification = record(row.verification);
  const name = label(labels.get(row.criterionId)) || `Critère ${index + 1}`;
  const result = `- **${name} — ${status(row.result)}**`;
  const method = [text(verification.environment), text(verification.method)].filter(Boolean).join(" ; ");
  const outcome = [result, method, text(row.remainder)].filter(Boolean).join(" — ");
  return [outcome, exactReferences("Source SHA-256", [row.sourceSha256]),
    exactReferences("Livraisons / obligations", list(row.deliveryOrObligationIds)),
    exactReferences("Preuves", list(row.proofIds))].filter(Boolean).join("\n");
}
function coverage(payload: PublicationPayload) {
  const closure = campaignReview(payload), report = record(closure.report), rows = list(report.rows);
  const explanation = payload.campaignReview ? ["La revue globale bloque la clôture. Consultez la couverture ci-dessous et le rapport Council avant de décider de la suite."] : [];
  if (!rows.length) return explanation;
  const labels = new Map(list(closure.coverage).map(value => { const item = record(value); return [item.criterionId, item.label]; }));
  const satisfied = rows.filter(value => record(value).result === "satisfied").length;
  return [...explanation, `### Couverture\n\n${satisfied}/${rows.length} critères satisfaits. Verdict : ${status(report.verdict)}.`,
    ...rows.map((row, index) => coverageLine(row, index, labels))];
}
function scope(context: PublicationPresentation) {
  const references = context.references.map(ref => `- [${label(ref.label)}](${https(ref.url)})`
    + (ref.version ? ` — version ${label(ref.version)}` : "")
    + (ref.sha256 ? ` — SHA-256 \`${text(ref.sha256)}\`` : ""));
  if (context.sourceSha256) references.push(`- Périmètre matériel SHA-256 : \`${text(context.sourceSha256)}\``);
  const sources = context.sources.map(source => `- ${label(source.label)}`);
  return [...references, ...sources];
}
function navigationUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    if ([url.username, url.password, url.search, url.hash].some(Boolean)) return "";
    const local = [url.protocol === "http:", ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)].every(Boolean);
    return https(url.href) || (local ? url.href : "");
  } catch { return ""; }
}
function campaignLink(context: PublicationPresentation) {
  const url = navigationUrl(context.campaignUrl);
  return url ? `[Campagne Paperclip](${url})` : "Lien vers la campagne Paperclip non configuré.";
}
function cancellationPr(item: Record<string, unknown>) {
  const url = https(item.url);
  return url ? ` — [Pull request](${url})` : "";
}
function retainedDeliveryLine(item: Record<string, unknown>, context: PublicationPresentation) {
  const verification = item.verified === true ? "vérifié" : "vérification incomplète";
  return `- ${label(sourceLabel(text(item.sourceId), context))} : intégré, ${verification}`
    + ` — commit \`${label(item.integratedCommit)}\`` + cancellationPr(item);
}
function cancellation(payload: PublicationPayload, context: PublicationPresentation) {
  const summary = record(payload.cancellationSummary);
  if (summary.schema !== "council-linear-cancellation-summary-v1") return [];
  const rows = (key: string) => list(summary[key]).map(record);
  const remaining = rows("remainingWork");
  return ["### Résultats conservés après annulation",
    ...rows("retainedDeliveries").map(item => retainedDeliveryLine(item, context)),
    ...rows("openPullRequests").map(item => `- ${label(sourceLabel(text(item.sourceId), context))} : PR ouverte, traitement humain requis` + cancellationPr(item)),
    `Travail restant : ${remaining.length}.`, ...remaining.map(item => `- ${label(sourceLabel(text(item.sourceId), context))}`)];
}
export function publicationText(payload: PublicationPayload, context: PublicationPresentation) {
  const statusChanges = statusLines(payload, context), scopeLines = scope(context);
  const parts = [`## Council — ${kinds[payload.kind]}`, campaignLink(context), ...plannedDeliveries(payload, context), ...progress(payload), ...coverage(payload), ...deliveryLinks(payload), ...cancellation(payload, context)];
  if (statusChanges.length) parts.push(`### Statuts à confirmer\n\n${statusChanges.join("\n")}`);
  if (scopeLines.length) parts.push(`### Périmètre fixé\n\n${scopeLines.join("\n")}`);
  if (parts.length === 2) parts.push("Le suivi de la campagne a été actualisé. Les preuves détaillées sont conservées dans Council.");
  return parts.join("\n\n");
}
