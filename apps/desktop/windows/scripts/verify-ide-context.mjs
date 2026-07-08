import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`IDE context verification failed: ${message}`);
    process.exit(1);
  }
}

const api = read("src/shared/desktopApi.ts");
const main = read("src/main/index.ts");
const ideContext = read("src/main/ideContext.ts");
const preload = read("src/preload/index.ts");
const app = read("src/renderer/src/App.tsx");
const chatWorkspace = read("src/renderer/src/components/ChatWorkspace.tsx");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const roadmap = read("docs/smart-chat-bar-roadmap.md");
const packageJson = read("package.json");

assert(
  api.includes("DesktopIdeContextSnapshot") &&
    api.includes("currentFile?: DesktopIdeContextFile") &&
    api.includes("currentSelection?: DesktopIdeContextSelection") &&
    api.includes("getIdeContext(workspacePath: string)"),
  "shared DesktopApi does not expose IDE current file/selection context",
);
assert(
  ideContext.includes(".drsai") &&
    ideContext.includes("ide-context.json") &&
    ideContext.includes("resolveWorkspaceFilePath") &&
    ideContext.includes("MAX_SELECTION_CHARS") &&
    ideContext.includes("isInsidePath"),
  "main-process IDE context adapter does not read and constrain the handoff file",
);
assert(
  main.includes("getIdeContext") && main.includes("desktop:ide-context"),
  "main process does not register IDE context IPC",
);
assert(
  preload.includes("getIdeContext") && preload.includes("desktop:ide-context"),
  "preload bridge does not expose IDE context IPC",
);
assert(
  mock.includes("getIdeContext") &&
    mock.includes("currentFile") &&
    mock.includes("currentSelection"),
  "mock desktop API does not provide IDE context data",
);
assert(
  app.includes("refreshIdeContext") &&
    app.includes("attachIdeCurrentFile") &&
    app.includes("attachIdeCurrentSelection") &&
    app.includes("kind: \"selection\"") &&
    app.includes("IDE current selection context"),
  "App does not convert IDE context into visible chat attachments",
);
assert(
  chatWorkspace.includes("IDE current file") &&
    chatWorkspace.includes("IDE selection") &&
    chatWorkspace.includes("Refresh IDE context") &&
    chatWorkspace.includes("canAttachIdeCurrentSelection") &&
    chatWorkspace.includes("FileCode2") &&
    chatWorkspace.includes("TextCursorInput"),
  "ChatWorkspace tool menu does not expose IDE attachment controls",
);
assert(
  roadmap.includes("IDE current file/current-selection adapters") &&
    roadmap.includes("verify:ide-context"),
  "roadmap does not record IDE context adapter progress",
);
assert(
  packageJson.includes('"verify:ide-context"'),
  "package script is not registered",
);

console.log("IDE context verification passed.");
