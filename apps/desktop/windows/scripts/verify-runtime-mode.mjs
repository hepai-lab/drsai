import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = join(root, "..", "..", "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readRepo(relativePath) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Runtime mode verification failed: ${message}`);
    process.exit(1);
  }
}

const chatCommands = read("src/renderer/src/chatCommands.ts");
const chatAdapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
const mainChat = read("src/main/chat.ts");
const gateway = readRepo("cores/python/packages/drsai/src/drsai/backend/gateway.py");
const roadmap = read("docs/smart-chat-bar-roadmap.md");
const packageJson = read("package.json");

const runtimeModes = ["plan", "goal", "review", "fix", "test", "commit", "fork"];

for (const mode of runtimeModes) {
  assert(chatCommands.includes(`"${mode}"`), `/${mode} is missing from the command registry`);
  assert(gateway.includes(`"${mode}":`), `${mode} backend runtime instruction is missing`);
}

assert(chatCommands.includes("createRuntimeModeAction"), "slash commands do not create runtime mode actions");
assert(chatCommands.includes('type: "set-runtime-mode"'), "runtime mode action type is missing");
assert(chatAdapter.includes("serializeRuntimeMode"), "renderer does not serialize runtime mode metadata");
assert(chatAdapter.includes("runtime_mode: currentRuntimeModeRef.current"), "renderer does not attach runtime mode metadata");
assert(chatAdapter.includes("Current chat runtime mode:"), "renderer system prompt runtime mode section is missing");
assert(mainChat.includes("metadata: isRecord(request.metadata) ? request.metadata : undefined"), "main process does not validate metadata");
assert(mainChat.includes("...(request.metadata || {})"), "main process does not forward metadata to gateway");
assert(gateway.includes("metadata: dict[str, Any] = Field"), "gateway ChatRequest does not accept metadata");
assert(gateway.includes("_CHAT_RUNTIME_MODE_INSTRUCTIONS"), "gateway runtime mode instruction map is missing");
assert(gateway.includes("def _runtime_mode_from_metadata"), "gateway runtime mode metadata parser is missing");
assert(gateway.includes('raw_mode = metadata.get("runtime_mode")'), "gateway does not read runtime_mode metadata");
assert(gateway.includes("name not in _CHAT_RUNTIME_MODE_INSTRUCTIONS"), "gateway does not whitelist runtime mode names");
assert(gateway.includes("def _task_with_runtime_mode"), "gateway does not build runtime-mode task instructions");
assert(gateway.includes('task = _task_with_runtime_mode(user_msgs[-1].content, request.metadata)'), "gateway does not apply runtime mode to the agent task");
assert(gateway.includes("Desktop runtime mode:"), "gateway task prefix is missing");
assert(roadmap.includes("backend planning, review, fix, test, commit, goal, and fork guidance"), "roadmap does not document backend runtime mode consumption");
assert(packageJson.includes('"verify:runtime-mode": "node scripts/verify-runtime-mode.mjs"'), "package script is not registered");

console.log(`Runtime mode verification passed (${runtimeModes.length} modes).`);
