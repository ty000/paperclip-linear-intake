import { z, type PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { configSchema } from "./config.js";

export default {
  id: "ty000.linear-intake",
  apiVersion: 1,
  version: "0.4.0",
  displayName: "Linear Todo Intake",
  description: "Explicitly enrolled Todo retention, native family preparation and optional authenticated source revalidation for Council.",
  author: "ty000",
  categories: ["connector"],
  capabilities: ["http.outbound", "secrets.read-ref", "ui.action.register", "webhooks.receive", "jobs.schedule",
    "events.subscribe", "events.emit",
    "database.namespace.read", "database.namespace.write", "database.namespace.migrate", "projects.read",
    "issues.read", "issues.create", "issue.documents.read", "issue.documents.write", "issue.relations.read", "issue.relations.write"],
  database: { namespaceSlug: "linear_intake", migrationsDir: "migrations", coreReadTables: [] },
  webhooks: [{ endpointKey: "linear-todo", displayName: "Linear Todo requests" }],
  jobs: [{ jobKey: "drain-intake", displayName: "Reconcile retained Linear requests", schedule: "* * * * *" },
    { jobKey: "prepare-import", displayName: "Prepare one retained native family", schedule: "* * * * *" }],
  entrypoints: { worker: "./dist/worker.js" },
  instanceConfigSchema: {
    ...z.toJSONSchema(configSchema, { target: "draft-7", io: "input" }),
    allOf: [{
      if: { required: ["enabled"], properties: { enabled: { const: true } } },
      then: { required: ["intake", "sourceReader", "gatewayDiscoveryEnabled", "gatewayUrl", "gatewayTokenRef"],
        properties: { gatewayDiscoveryEnabled: { const: true } } },
    }, {
      if: { required: ["nativeImportEnabled"], properties: { nativeImportEnabled: { const: true } } },
      then: { required: ["intake", "sourceReader", "gatewayDiscoveryEnabled", "gatewayUrl", "gatewayTokenRef"],
        properties: { gatewayDiscoveryEnabled: { const: true } } },
    }, {
      if: { required: ["councilHandoffEnabled"], properties: { councilHandoffEnabled: { const: true } } },
      then: { required: ["nativeImportEnabled"],
        properties: { nativeImportEnabled: { const: true } } },
    }],
  },
} satisfies PaperclipPluginManifestV1;
