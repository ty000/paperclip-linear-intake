// Optional authorized recipe replay. Uses an existing native CLI board login.
// No provisioning, source tool calls, credential extraction or runtime changes.
// Append "family-reader" to verify the eight-read profile used by 0.1.3.
// node --import <host-tsx-loader> scripts/qualification/native-catalog-readback.mjs <host-repo> <private-receipt.json> [family-reader]
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

function validateProfileEntry(entry, connectionId) {
  if (entry.selectorType !== 'catalog_entry' || entry.effect !== 'include' || entry.connectionId !== connectionId) {
    throw new Error();
  }
}

function validateReadOnlyTool(tool) {
  if (!tool.isReadOnly || tool.isWrite || tool.isDestructive) throw new Error();
}

try {
  const familyReader = process.argv[4] === 'family-reader';
  if (process.argv.length !== (familyReader ? 5 : 4)) throw new Error();
  const allowed = ['get_issue', 'list_issues', 'get_project', 'get_team', 'get_issue_status', 'list_issue_statuses', 'list_teams'];
  if (familyReader) allowed.push('get_workspace');
  const receipt = JSON.parse(readFileSync(process.argv[3]));
  const endpoint = new URL(receipt.gatewayUrl);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1'
      || !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || !/^\/mcp\/gateways\/[A-Za-z0-9_-]+$/.test(endpoint.pathname)) throw new Error();
  const { getStoredBoardCredential } = await import(pathToFileURL(resolve(process.argv[2], 'cli/src/client/board-auth.ts')).href);
  const credential = getStoredBoardCredential(endpoint.origin);
  if (!credential) throw new Error();
  async function api(path, body) {
    const r = await fetch(endpoint.origin + path, { method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${credential.token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error();
    return r.json();
  }
  const plugins = await api('/api/plugins');
  const plugin = plugins.find(p => p.id === receipt.pluginId);
  const config = (await api(`/api/plugins/${receipt.pluginId}/config?companyId=${receipt.companyId}`)).configJson;
  const profiles = (await api(`/api/companies/${receipt.companyId}/tools/profiles`)).profiles;
  const gateways = (await api(`/api/companies/${receipt.companyId}/tools/gateways`)).gateways;
  const catalog = (await api(`/api/tool-connections/${receipt.connectionId}/catalog`)).catalog;
  const profile = profiles.find(p => p.id === receipt.profileId), gateway = gateways.find(g => g.id === receipt.gatewayId);
  if (plugin?.pluginKey !== 'ty000.linear-intake' || plugin.status !== 'ready'
      || config.enabled !== false || config.gatewayDiscoveryEnabled !== true
      || config.gatewayUrl !== receipt.gatewayUrl || config.gatewayTokenRef?.secretId !== receipt.secretId
      || profile?.defaultAction !== 'deny' || profile.entries.length !== allowed.length
      || gateway?.profileId !== profile.id || gateway.defaultProfileMode !== 'gateway_only') throw new Error();
  const names = profile.entries.map(entry => {
    validateProfileEntry(entry, receipt.connectionId);
    const tool = catalog.find(t => t.id === entry.catalogEntryId);
    if (!tool || tool.status !== 'active') throw new Error();
    validateReadOnlyTool(tool);
    return tool.toolName;
  });
  if (new Set(names).size !== allowed.length || names.some(n => !allowed.includes(n))) throw new Error();
  const result = await api(`/api/plugins/${receipt.pluginId}/bridge/action`, {
    companyId: receipt.companyId, key: 'inspect-gateway', params: {},
  });
  // 0.2.0 names the action's no-import guarantee explicitly. The separate
  // native configuration check above still requires retention to be disabled.
  const inactiveField = Object.hasOwn(result.data ?? {}, 'importEnabled') ? 'importEnabled' : 'intakeEnabled';
  if (result.data?.status !== 'catalog_observed' || result.data[inactiveField] !== false
      || result.data.tools.length !== allowed.length + 4) throw new Error();
  if (familyReader && (config.sourceProbe || config.sourceReader)) throw new Error();
  const expectedNames = [...allowed.map(n => n.replaceAll('_', '-')),
    'paperclip_list_resources', 'paperclip_read_resource', 'paperclip_list_prompts', 'paperclip_get_prompt'].sort();
  const observedNames = result.data.tools.map(t => t.name.includes(':') ? t.name.slice(t.name.lastIndexOf(':') + 1) : t.name).sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(observedNames)) throw new Error();
  console.log(JSON.stringify({ schema: 'linear-intake-native-catalog-readback.v1', observedAt: new Date().toISOString(),
    pluginVersion: plugin.version, pluginStatus: plugin.status, intakeEnabled: config.enabled,
    sourceProbeConfigured: !!config.sourceProbe, manifestHasSourceProbe: !!plugin.manifestJson?.instanceConfigSchema?.properties?.sourceProbe,
    sourceReaderConfigured: !!config.sourceReader, manifestHasSourceReader: !!plugin.manifestJson?.instanceConfigSchema?.properties?.sourceReader,
    dedicatedReadProfileVerified: true, readToolCount: names.length, totalCatalogCount: result.data.tools.length,
    catalogSha256: result.data.catalogSha256, sourceCoverage: result.data.sourceCoverage,
    installedWorkerSha256: createHash('sha256').update(readFileSync(resolve(plugin.packagePath, 'dist/worker.js'))).digest('hex'),
    installedManifestSha256: createHash('sha256').update(readFileSync(resolve(plugin.packagePath, 'dist/manifest.js'))).digest('hex'),
    installedRuntimeSha256: Object.fromEntries(readdirSync(resolve(plugin.packagePath, 'dist')).filter(n => n.endsWith('.js')).sort()
      .map(n => [`dist/${n}`, createHash('sha256').update(readFileSync(resolve(plugin.packagePath, 'dist', n))).digest('hex')])),
  }, null, 2));
} catch {
  console.error('Native readback failed; no credential, response or private configuration emitted.');
  process.exitCode = 1;
}
