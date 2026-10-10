import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const outputDir = join(root, "artifacts", "package");
const expectedTarball = `${packageJson.name.slice(1).replace("/", "-")}-${packageJson.version}.tgz`;
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const pack = run("npm", ["pack", "--json", "--pack-destination", outputDir], root);
assert.equal(pack.status, 0, pack.stderr);
const reports = JSON.parse(pack.stdout);
assert.equal(reports.length, 1, "npm pack must produce exactly one archive");
const report = reports[0];
assert.equal(report.filename, expectedTarball, "archive name must match package name and version");
assert.equal(report.name, packageJson.name);
assert.equal(report.version, packageJson.version);

const tracked = run("git", ["ls-files", "-z", "--", "src", "migrations"], root);
assert.equal(tracked.status, 0, tracked.stderr);
const expectedFiles = new Set(["package.json", "README.md", "LICENSE"]);
for (const path of tracked.stdout.split("\0").filter(Boolean)) {
  if (path.startsWith("migrations/") && path.endsWith(".sql")) expectedFiles.add(path);
  if (path.startsWith("src/") && path.endsWith(".ts")) {
    const output = `dist/${path.slice(4, -3)}`;
    expectedFiles.add(`${output}.js`);
    expectedFiles.add(`${output}.js.map`);
    expectedFiles.add(`${output}.d.ts`);
  }
}
const packedFiles = new Set(report.files.map(entry => entry.path.replace(/^package\//, "")));
assert.deepEqual([...packedFiles].sort(), [...expectedFiles].sort(), "archive must contain only tracked runtime outputs and release files");

const tarball = join(outputDir, report.filename);
const consumer = await mkdtemp(join(tmpdir(), "paperclip-linear-intake-package-"));
try {
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const install = run("npm", ["install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", tarball], consumer);
  assert.equal(install.status, 0, install.stderr);
  const productionTree = run("npm", ["ls", "--all", "--omit=dev", "--json"], consumer);
  assert.equal(productionTree.status, 0, productionTree.stderr);
  const installedRoot = join(consumer, "node_modules", ...packageJson.name.split("/"));
  const installedPackage = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
  assert.equal(installedPackage.version, packageJson.version);
  const manifest = (await import(pathToFileURL(join(installedRoot, installedPackage.paperclipPlugin.manifest)))).default;
  assert.equal(manifest.id, "ty000.linear-intake");
  assert.equal(manifest.version, packageJson.version);
  await smokeWorker(join(installedRoot, installedPackage.paperclipPlugin.worker), manifest);
} finally {
  await rm(consumer, { recursive: true, force: true });
}

const evidence = {
  package: `${packageJson.name}@${packageJson.version}`,
  tarball: report.filename,
  integrity: report.integrity,
  shasum: report.shasum,
  fileCount: report.entryCount,
  unpackedSize: report.unpackedSize,
  archiveRoots: ["dist", "migrations", "README.md", "LICENSE", "package.json"],
  install: { omitDev: true, ignoreScripts: true },
  manifest: { id: "ty000.linear-intake", version: packageJson.version },
  worker: { transport: "json-rpc-stdio", provider: "none", health: "degraded" },
};
await writeFile(join(outputDir, "package-smoke.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, npm_config_ignore_scripts: "true" },
  });
  if (result.error) throw result.error;
  if (result.status === null) throw new Error(`${command} exited without a status`);
  return result;
}

async function smokeWorker(workerPath, manifest) {
  const child = spawn(process.execPath, [workerPath], { cwd: dirname(workerPath), stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const replies = new Map();
  const hostCalls = [];
  let stderr = "";
  const workerTimeout = setTimeout(() => child.kill(), 10_000);
  child.stderr.on("data", data => { stderr += data; });
  lines.on("line", line => {
    const message = JSON.parse(line);
    if (message.method) {
      hostCalls.push(message.method);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: null })}\n`);
    } else {
      const pending = replies.get(message.id);
      if (pending) {
        replies.delete(message.id);
        clearTimeout(pending.timeout);
        pending.resolve(message);
      }
    }
  });
  const rejectPending = error => {
    for (const pending of replies.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    replies.clear();
  };
  child.once("error", error => rejectPending(error));
  child.once("exit", (code, signal) => rejectPending(new Error(`worker exited before reply: code=${code} signal=${signal}`)));
  let id = 0;
  const rpc = (method, params = {}) => new Promise((resolveReply, rejectReply) => {
    const requestId = ++id;
    const timeout = setTimeout(() => {
      replies.delete(requestId);
      rejectReply(new Error(`worker RPC timed out: ${method}`));
    }, 5_000);
    replies.set(requestId, { resolve: resolveReply, reject: rejectReply, timeout });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
  });
  try {
    assert.equal((await rpc("initialize", { manifest, config: {} })).result.ok, true);
    assert.equal((await rpc("health")).result.status, "degraded");
    const exited = once(child, "exit");
    await rpc("shutdown");
    assert.equal((await exited)[0], 0);
    assert.deepEqual(hostCalls, ["events.subscribe", "events.subscribe"]);
    assert.equal(stderr, "");
  } finally {
    clearTimeout(workerTimeout);
    rejectPending(new Error("worker smoke finished"));
    if (child.exitCode === null) child.kill();
  }
}
