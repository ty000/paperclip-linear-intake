import { z, type PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { configSchema } from "./config.js";

export default {
  id: "ty000.linear-intake",
  apiVersion: 1,
  version: "0.1.4",
  displayName: "Linear Todo Intake (qualification)",
  description: "Disabled intake with catalog discovery and operator-only source qualification.",
  author: "ty000",
  categories: ["connector"],
  capabilities: ["http.outbound", "secrets.read-ref", "ui.action.register"],
  entrypoints: { worker: "./dist/worker.js" },
  instanceConfigSchema: z.toJSONSchema(configSchema, { target: "draft-7", io: "input" }),
} satisfies PaperclipPluginManifestV1;
