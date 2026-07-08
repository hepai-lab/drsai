import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/main/sseParser.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    strict: true,
  },
}).outputText;

const module = { exports: {} };
new Script(compiled, { filename: "sseParser.ts" }).runInNewContext({
  exports: module.exports,
  module,
  require,
});

const {
  isCompletionDoneFrame,
  parseAgentLogSseFrame,
  parseAgentRunSseFrame,
  parseChatSseFrame,
  parseCompletionSseFrame,
} = module.exports;

function assertDeepEqual(name, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

assertDeepEqual(
  "delta content",
  parseChatSseFrame('data: {"choices":[{"delta":{"content":"hello"}}]}'),
  ["hello"],
);
assertDeepEqual(
  "agent run delta content",
  parseAgentRunSseFrame('data: {"choices":[{"delta":{"content":"agent"}}]}'),
  ["agent"],
);
assertDeepEqual(
  "completion parser alias",
  parseCompletionSseFrame('data: {"choices":[{"delta":{"content":"completion"}}]}'),
  ["completion"],
);
assertDeepEqual(
  "agent log is not chat content",
  parseChatSseFrame('event: agent.log\ndata: {"title":"LLM Retry","content":"retrying","level":"WARNING"}'),
  [],
);
assertDeepEqual(
  "agent log payload",
  parseAgentLogSseFrame('event: agent.log\ndata: {"title":"LLM Retry","content":"retrying","level":"WARNING"}'),
  { title: "LLM Retry", content: "retrying", level: "WARNING", content_type: undefined },
);
assertDeepEqual(
  "message content with CRLF",
  parseChatSseFrame('data: {"choices":[{"message":{"content":"done"}}]}\r\n'),
  ["done"],
);
assertDeepEqual("done sentinel", parseChatSseFrame("data: [DONE]"), []);
assertDeepEqual("malformed frame", parseChatSseFrame("data: not-json"), []);

if (!isCompletionDoneFrame("event: done\ndata: [DONE]")) {
  throw new Error("done frame detector did not detect [DONE]");
}
if (isCompletionDoneFrame('data: {"choices":[{"delta":{"content":"not done"}}]}')) {
  throw new Error("done frame detector returned true for a content frame");
}

try {
  parseAgentRunSseFrame('data: {"error":{"message":"bad key"}}');
  throw new Error("error payload did not throw");
} catch (error) {
  if (!error || error.message !== "bad key") {
    throw error;
  }
}

console.log("Chat SSE parser verification passed.");
