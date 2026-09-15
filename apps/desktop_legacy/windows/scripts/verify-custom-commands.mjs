import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Custom command verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const api = read("../shared/api/desktopApi.ts");
const main = read("src/main/index.ts");
const store = read("src/main/customCommands.ts");
const preload = read("../shared/main/preload.ts");
const mock = read("../shared/renderer/src/mockDesktopApi.ts");
const commands = read("../shared/renderer/src/chatCommands.ts");
const adapter = read("../shared/renderer/src/adapters/useDesktopChatAdapter.ts");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(
  packageJson.includes('"verify:custom-commands": "node scripts/verify-custom-commands.mjs"'),
  "package script is not registered",
);

assert(api.includes("DesktopCustomCommand"), "shared API omits custom command type");
assert(
  api.includes("DesktopCustomCommandListRequest") &&
    api.includes("DesktopCustomCommandUpsertRequest") &&
    api.includes("DesktopCustomCommandDeleteRequest"),
  "shared API omits custom command request types",
);
assert(
  api.includes("listCustomCommands(") &&
    api.includes("upsertCustomCommand(") &&
    api.includes("deleteCustomCommand("),
  "desktop API omits custom command methods",
);

assert(store.includes("custom-commands.json"), "main store does not persist custom commands");
assert(store.includes("workspaceKey("), "main store is not workspace scoped");
assert(
  store.includes("MAX_CUSTOM_COMMANDS_PER_WORKSPACE") &&
    store.includes("MAX_COMMAND_PROMPT_CHARS"),
  "main store lacks bounded validation",
);
assert(store.includes("RESERVED_COMMAND_NAMES"), "main store does not reserve built-in command names");
assert(store.includes("upsertCustomCommand"), "main store omits upsertCustomCommand");
assert(store.includes("deleteCustomCommand"), "main store omits deleteCustomCommand");

assert(main.includes('from "./customCommands"'), "main process does not import custom command store");
assert(main.includes('secureHandle("desktop:custom-commands-list"'), "main process omits list IPC");
assert(main.includes('secureHandle("desktop:custom-command-upsert"'), "main process omits upsert IPC");
assert(main.includes('secureHandle("desktop:custom-command-delete"'), "main process omits delete IPC");

assert(preload.includes("DesktopCustomCommand"), "preload omits custom command type imports");
assert(preload.includes("desktop:custom-commands-list"), "preload omits list bridge");
assert(preload.includes("desktop:custom-command-upsert"), "preload omits upsert bridge");
assert(preload.includes("desktop:custom-command-delete"), "preload omits delete bridge");

assert(mock.includes("let customCommands"), "mock API omits custom command store");
assert(mock.includes("listCustomCommands"), "mock API omits listCustomCommands");
assert(mock.includes("upsertCustomCommand"), "mock API omits upsertCustomCommand");
assert(mock.includes("deleteCustomCommand"), "mock API omits deleteCustomCommand");

assert(commands.includes('"command"'), "slash command registry omits /command");
assert(commands.includes('case "command"'), "slash command runner omits /command branch");
assert(commands.includes("describeCustomCommandManager"), "/command manager feedback is missing");
assert(commands.includes("describeCustomCommandInvocation"), "unknown custom command invocation is missing");
assert(commands.includes('type: "set-input"'), "custom command invocation does not expand into composer");
assert(commands.includes("{{args}}"), "custom command templates do not support args placeholder");
assert(commands.includes("Nothing was sent automatically"), "custom command safety copy is missing");

assert(adapter.includes("listCustomCommands({ workspacePath, limit: 100 })"), "adapter does not load custom commands");
assert(adapter.includes("customCommands,"), "adapter does not pass custom commands into command context");
assert(adapter.includes("maybeApplyCustomCommand"), "adapter does not apply /command add/delete");
assert(adapter.includes("desktopApi.upsertCustomCommand"), "adapter does not call custom command upsert");
assert(adapter.includes("desktopApi.deleteCustomCommand"), "adapter does not call custom command delete");
assert(adapter.includes('action.type === "set-input"'), "adapter does not handle custom command expansion action");
assert(
  adapter.includes('result.action?.type !== "set-input"'),
  "adapter clears expanded custom command input",
);

assert(
  roadmap.includes("custom commands") &&
    roadmap.includes("npm run verify:custom-commands"),
  "roadmap does not record custom command verification",
);

console.log("Custom command verification passed.");
