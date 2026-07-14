import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function importTypeScript(relativePath) {
  const source = readFileSync(join(root, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const {
  createPublicAgentCachePayload,
  mergeAndSortAgents,
  parsePublicAgentCachePayload,
} = await importTypeScript("src/main/agentCatalog.ts");

const local = {
  id: "my-drsai",
  name: "My DrSai",
  description: "Local",
  owner: "Local",
  source: "local",
  status: "running",
  available: true,
};
const defaultPlatform = {
  id: "platform:default",
  name: "Zeta",
  description: "Default",
  owner: "OpenDrSai",
  source: "remote",
  status: "running",
  mode: "ddf",
  available: true,
  isDefault: true,
};
const featuredPlatform = {
  id: "platform:featured",
  name: "Alpha",
  description: "Featured",
  owner: "OpenDrSai",
  source: "remote",
  status: "running",
  mode: "remote",
  available: true,
  featured: true,
};
const unavailable = {
  id: "platform:offline",
  name: "Beta",
  description: "Offline",
  owner: "OpenDrSai",
  source: "remote",
  status: "unreachable",
  available: false,
};

const merged = mergeAndSortAgents(
  [featuredPlatform, unavailable],
  [defaultPlatform, local, { ...featuredPlatform, name: "Duplicate must be ignored" }],
);
assert.deepEqual(
  merged.map((agent) => agent.id),
  ["my-drsai", "platform:default", "platform:featured", "platform:offline"],
  "catalog order must be local, default, featured, available, then unavailable",
);
assert.equal(merged.find((agent) => agent.id === "platform:featured").name, "Alpha");

const unsafeRuntimeAgent = {
  ...defaultPlatform,
  localizedDescription: { en: "English", zh: "中文" },
  url: "https://private.invalid",
  api_key: "MUST_NOT_REACH_CACHE",
  config: { secret: "MUST_NOT_REACH_CACHE_EITHER" },
};
const payload = createPublicAgentCachePayload(
  [unsafeRuntimeAgent],
  "2026-07-14T00:00:00.000Z",
);
const serialized = JSON.stringify(payload);
assert(!serialized.includes("MUST_NOT_REACH_CACHE"));
assert(!serialized.includes("private.invalid"));
assert.equal(payload.agents[0].isDefault, true);
assert.equal(payload.agents[0].mode, "ddf");
assert.deepEqual(payload.agents[0].localizedDescription, { en: "English", zh: "中文" });

const parsed = parsePublicAgentCachePayload(JSON.parse(serialized));
assert.equal(parsed.version, 1);
assert.equal(parsed.savedAt, "2026-07-14T00:00:00.000Z");
assert.equal(parsed.agents[0].id, "platform:default");
assert.deepEqual(parsed.agents[0].localizedDescription, { en: "English", zh: "中文" });
assert.equal(parsePublicAgentCachePayload({ version: 2, agents: [] }), null);
assert.equal(parsePublicAgentCachePayload({ version: 1, savedAt: 4, agents: [] }), null);

const poisonedPlatformCache = parsePublicAgentCachePayload({
  version: 1,
  savedAt: "2026-07-14T00:00:00.000Z",
  agents: [{
    id: "platform:must-stay-remote",
    name: "HAI Agent",
    source: "local",
    catalogGroup: "local",
    status: "running",
  }],
});
assert.equal(poisonedPlatformCache.agents[0].source, "remote", "HAI cache records must never become local agents");
assert.equal(poisonedPlatformCache.agents[0].catalogGroup, "official", "HAI cache records must never enter the local group");

const staleSyntheticCache = parsePublicAgentCachePayload({
  version: 1,
  savedAt: "2026-07-14T00:00:00.000Z",
  agents: [
    { id: "platform:hai.native.ddf", name: "Synthetic DDF", source: "remote", status: "running" },
    { id: "platform:real-ddf", name: "Real DDF", source: "remote", status: "running" },
  ],
});
assert.deepEqual(staleSyntheticCache.agents.map((agent) => agent.id), ["platform:real-ddf"], "stale synthetic HAI templates must not be restored");

const legacyLocalizedCache = parsePublicAgentCachePayload({
  version: 1,
  savedAt: "2026-07-14T00:00:00.000Z",
  agents: [{
    id: "platform:legacy-localized",
    name: "Legacy localized agent",
    description: JSON.stringify({ en: "Legacy English", zh: "旧缓存中文" }),
    source: "remote",
    status: "running",
  }],
});
assert.equal(legacyLocalizedCache.agents[0].description, "Legacy English");
assert.deepEqual(legacyLocalizedCache.agents[0].localizedDescription, { en: "Legacy English", zh: "旧缓存中文" });

const agentSource = readFileSync(join(root, "src/main/agents.ts"), "utf8");
const preloadSource = readFileSync(join(root, "src/preload/index.ts"), "utf8");
assert(agentSource.includes("platformExecutionDescriptors"), "Main-private execution descriptor map is missing");
assert(agentSource.includes("PLATFORM_CACHE_TTL_MS"), "catalog cache TTL is missing");
assert(agentSource.includes("createPublicAgentCachePayload"), "public-only cache serializer is not used");
assert(!agentSource.includes("listRemoteAgents"), "Agent Square must not merge legacy local remote-agent files");
assert(!agentSource.includes("remote_agents.json"), "Agent Square must source non-local agents exclusively from HAI");
assert(preloadSource.includes('ipcRenderer.invoke("desktop:list-agents", options)'), "refresh options do not cross IPC");

console.log("Agent square B1-B6 catalog verification passed (merge/order, stable IDs, public cache, private descriptors, refresh IPC). ");
