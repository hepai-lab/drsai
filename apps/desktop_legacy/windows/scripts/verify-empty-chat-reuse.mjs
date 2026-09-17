import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadModule(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Script(compiled, { filename: relativePath }).runInNewContext({
    exports: module.exports,
    module,
    require,
  });
  return module.exports;
}

const {
  isReusableEmptyChatThread,
  findReusableEmptyChatThread,
  duplicateEmptyChatThreadIds,
} = loadModule("../src/shared/threadTitle.ts");
const { sameWorkspacePath } = loadModule("../src/shared/pathUtils.ts");

function assertEqual(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(name, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const emptyA = {
  id: "a",
  kind: "chat",
  title: "新会话",
  workspacePath: "D:\\ws\\demo",
  messageCount: 0,
  updatedAt: "2026-07-20T00:00:00.000Z",
};
const emptyB = {
  id: "b",
  kind: "chat",
  title: "New chat",
  workspacePath: "d:/ws/demo/",
  messageCount: 0,
  updatedAt: "2026-07-21T00:00:00.000Z",
};
const used = {
  id: "c",
  kind: "chat",
  title: "你好",
  workspacePath: "D:\\ws\\demo",
  messageCount: 2,
  updatedAt: "2026-07-21T01:00:00.000Z",
};
const otherWs = {
  id: "d",
  kind: "chat",
  title: "新会话",
  workspacePath: "D:\\ws\\other",
  messageCount: 0,
  updatedAt: "2026-07-21T02:00:00.000Z",
};

assertEqual("empty reusable", isReusableEmptyChatThread(emptyA), true);
assertEqual("used not reusable", isReusableEmptyChatThread(used), false);
assertEqual(
  "snapshot blocks reuse",
  isReusableEmptyChatThread(emptyA, { messageCount: 3, title: "新会话" }),
  false,
);

const picked = findReusableEmptyChatThread(
  [emptyA, emptyB, used, otherWs],
  "D:/ws/demo",
  sameWorkspacePath,
);
assertEqual("picks newest empty", picked?.id, "b");

assertDeepEqual(
  "duplicate ids drop older",
  duplicateEmptyChatThreadIds([emptyA, emptyB, used, otherWs], sameWorkspacePath).sort(),
  ["a"],
);

const appSource = readFileSync(
  new URL("../src/renderer/src/App.tsx", import.meta.url),
  "utf8",
);
if (!appSource.includes("findReusableEmptyChatThread")) {
  throw new Error("App.tsx does not reuse empty chat threads on new chat");
}
if (!appSource.includes("duplicateEmptyChatThreadIds")) {
  throw new Error("App.tsx does not prune duplicate empty chat threads");
}

console.log("verify-empty-chat-reuse: ok");
