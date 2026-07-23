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

const { normalizeWorkspacePath, sameWorkspacePath } = loadModule(
  "../src/shared/pathUtils.ts",
);
const { mapSessionToThread } = loadModule("../src/shared/threadSessionMap.ts");

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

assertEqual("empty null", normalizeWorkspacePath(null), "");
assertEqual("empty undef", normalizeWorkspacePath(undefined), "");
assertEqual("trim spaces", normalizeWorkspacePath("  C:\\Work\\Demo\\  "), "c:/work/demo");
assertEqual("slash collapse", normalizeWorkspacePath("D:/a/b/"), "d:/a/b");
assertEqual("mixed seps", normalizeWorkspacePath("D:\\a/b\\c"), "d:/a/b/c");
assertEqual(
  "same path",
  sameWorkspacePath("C:\\Projects\\App", "c:/Projects/App/"),
  true,
);
assertEqual(
  "different path",
  sameWorkspacePath("C:\\Projects\\App", "C:\\Projects\\Other"),
  false,
);

const mapped = mapSessionToThread({
  session_id: "sess-1",
  name: "Remote chat",
  workspace_path: "D:\\ws\\demo\\",
  updated_at: "2026-07-01T12:00:00.000Z",
  message_count: 3,
  pinned: true,
});
assertDeepEqual("mapSessionToThread", mapped, {
  id: "sess-1",
  kind: "chat",
  title: "Remote chat",
  workspacePath: "D:\\ws\\demo\\",
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-01T12:00:00.000Z",
  status: "idle",
  messageCount: 3,
  pinned: true,
});

assertEqual(
  "map missing id",
  mapSessionToThread({ name: "no id" }),
  null,
);

const withFallback = mapSessionToThread(
  { thread_id: "t-2", title: "T" },
  { workspacePath: "E:\\fallback" },
);
assertEqual("fallback workspace", withFallback?.workspacePath, "E:\\fallback");

console.log("verify-path-utils: ok");
