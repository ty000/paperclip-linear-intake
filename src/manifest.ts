import { z, type PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { configSchema } from "./config.js";

export default {
  id: "ty000.linear-intake",
  apiVersion: 1,
  version: "0.2.0",
  displayName: "Linear Todo Intake",
  description: "Explicitly enrolled Todo request retention and bounded source retrieval; no import or admission.",
  author: "ty000",
  categories: ["connector"],
  capabilities: ["http.outbound", "secrets.read-ref", "ui.action.register", "webhooks.receive", "jobs.schedule",
    "database.namespace.read", "database.namespace.write", "database.namespace.migrate"],
  database: { namespaceSlug: "linear_intake", migrationsDir: "migrations", coreReadTables: [] },
  webhooks: [{ endpointKey: "linear-todo", displayName: "Linear Todo requests" }],
  jobs: [{ jobKey: "drain-intake", displayName: "Reconcile retained Linear requests", schedule: "* * * * *" }],
  entrypoints: { worker: "./dist/worker.js" },
  instanceConfigSchema: {
    ...z.toJSONSchema(configSchema, { target: "draft-7", io: "input" }),
    allOf: [{
      if: { required: ["enabled"], properties: { enabled: { const: true } } },
      then: { required: ["intake", "sourceReader", "gatewayDiscoveryEnabled", "gatewayUrl", "gatewayTokenRef"],
        properties: { gatewayDiscoveryEnabled: { const: true } } },
    }],
  },
} satisfies PaperclipPluginManifestV1;
