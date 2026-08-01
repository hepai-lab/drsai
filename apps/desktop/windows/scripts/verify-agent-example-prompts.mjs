import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = await build({
  entryPoints: [resolve(root, "../shared/renderer/src/agentExamplePrompts.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`;
const { getAgentEmptyChatPrompts, parseCatalogAgentExamples } = await import(moduleUrl);

const localized = [
  { zh: "检查事例选择", en: "Review event selection" },
  { zh: "生成分析方案", en: "Create an analysis plan" },
];
assert.deepEqual(parseCatalogAgentExamples(localized, "zh"), ["检查事例选择", "生成分析方案"]);
assert.deepEqual(parseCatalogAgentExamples(localized, "en"), ["Review event selection", "Create an analysis plan"]);
assert.deepEqual(
  getAgentEmptyChatPrompts(["远程智能体专属任务"], "zh"),
  ["远程智能体专属任务"],
  "dedicated examples must not be padded with generic Desktop examples",
);
assert.equal(getAgentEmptyChatPrompts([], "zh").length, 4);
assert.equal(getAgentEmptyChatPrompts([], "en").length, 4);
assert.deepEqual(parseCatalogAgentExamples(["A", "A", "B", "C", "D", "E"], "en"), ["A", "B", "C", "D"]);
assert.equal(parseCatalogAgentExamples(["x".repeat(600)], "en")[0].length, 500);
assert.deepEqual(parseCatalogAgentExamples(['{"zh":"中文任务","en":"English task"}'], "zh"), ["中文任务"]);

const chatWorkspace = readFileSync(resolve(root, "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
assert(
  chatWorkspace.includes("if (dedicated.length > 0) return dedicated;"),
  "ChatWorkspace must use dedicated agent examples without padding them with generic prompts",
);
const app = readFileSync(resolve(root, "../shared/renderer/src/App.tsx"), "utf8");
assert(
  app.includes("remotePlatformChatAvailable || Boolean(health?.installed || health?.gateway?.externalReady)")
  && app.includes("!remotePlatformChatAvailable && (auth.serviceBusy || !auth.serviceReady)"),
  "a ready remote platform agent must remain usable when the local model runtime is unavailable",
);
assert(
  app.includes("const agent = options.agent ?? availableChatAgents.find")
  && app.includes("agent,\n            }).then")
  && app.includes("samplePrompts={selectedChatAgent?.examples ?? selectedChatExamples}"),
  "Agent Square must carry its freshly fetched remote-agent examples into the empty chat view",
);

console.log("Agent example prompt verification passed (localization, dedicated-only display, fallback, dedupe and bounds).");
