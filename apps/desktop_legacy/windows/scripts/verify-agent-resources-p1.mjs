import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const api = read("../shared/api/desktopApi.ts");
const main = read("../shared/main/myDrSaiConfig.ts");
const preload = read("../shared/main/preload.ts");
const app = read("../shared/renderer/src/App.tsx");
const adapter = read("../shared/renderer/src/adapters/useDesktopChatAdapter.ts");
const windowsMain = read("src/main/index.ts");

for (const symbol of [
  "getMyDrSaiAgentToolPolicy", "updateMyDrSaiAgentToolPolicy", "previewMyDrSaiAgentTools", "testAgentTool",
  "getMyDrSaiAgentSkillPolicy", "updateMyDrSaiAgentSkillPolicy", "previewMyDrSaiAgentSkills",
  "getMyDrSaiAgentKnowledgePolicy", "updateMyDrSaiAgentKnowledgePolicy", "previewMyDrSaiAgentKnowledge",
  "testKnowledgeBase", "indexKnowledgeBase", "searchKnowledgeBase",
  "listPerceptors", "savePerceptor", "testPerceptor", "deletePerceptor",
]) {
  assert(api.includes(`${symbol}(`), `Desktop API is missing ${symbol}`);
  assert(main.includes(`function ${symbol}(`), `Desktop main adapter is missing ${symbol}`);
  assert(preload.includes(`${symbol}:`), `Desktop preload is missing ${symbol}`);
}

for (const channel of [
  "desktop:test-agent-tool", "desktop:test-knowledge-base", "desktop:search-knowledge-base",
  "desktop:preview-my-drsai-agent-tools", "desktop:preview-my-drsai-agent-skills", "desktop:preview-my-drsai-agent-knowledge",
  "desktop:list-perceptors", "desktop:save-perceptor", "desktop:test-perceptor", "desktop:delete-perceptor",
]) assert(windowsMain.includes(channel), `IPC registration is missing ${channel}`);

assert(app.includes('useState<"perception" | "tools" | "skills" | "knowledge">'), "BAMS perception and Agent resources tabs are missing");
assert(app.includes("Tavily API Key") && app.includes("savePerceptor"), "Tavily perceptor configuration UI is missing");
assert(app.includes("allow_thread_override"), "Per-task skill override control is missing");
assert(app.includes("require_citations"), "Knowledge citation control is missing");
assert(app.includes("searchKnowledgeBase"), "Knowledge search preview UI is missing");
assert(app.includes("testAgentTool") && app.includes("testKnowledgeBase"), "Resource diagnostics UI is missing");
assert(adapter.includes("selected_skill_id: skillName || undefined"), "Structured temporary Skill selection is missing");
assert(!api.includes("credential_ref:"), "Credential references must not be modeled in Renderer API state");

console.log("Agent tools, skills, and knowledge P1 Desktop verification passed.");
