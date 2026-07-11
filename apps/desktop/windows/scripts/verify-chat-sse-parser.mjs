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
  parseChatToolTimelineSseFrame,
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
assertDeepEqual(
  "tool timeline direct event",
  parseChatToolTimelineSseFrame(
    'event: tool.progress\ndata: {"tool":"shell","title":"Run tests","status":"running","message":"npm run verify:ui"}',
  ).map(({ kind, title, status, content, toolName }) => ({ kind, title, status, content, toolName })),
  [{ kind: "log", title: "Run tests", status: "running", content: "npm run verify:ui", toolName: "shell" }],
);
assertDeepEqual(
  "tool timeline metadata array",
  parseChatToolTimelineSseFrame(
    'data: {"metadata":{"tool_calls":[{"kind":"tool_result","name":"pytest","status":"done","output":"2 passed"}]}}',
  ).map(({ kind, title, status, content, toolName }) => ({ kind, title, status, content, toolName })),
  [{ kind: "tool_result", title: "Tool: pytest", status: "completed", content: "2 passed", toolName: "pytest" }],
);
assertDeepEqual(
  "tool timeline openai chat tool_calls",
  parseChatToolTimelineSseFrame(
    'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_read","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"src/main.ts\\"}"}}]}}]}',
  ).map(({ id, kind, title, content, path, toolName }) => ({ id, kind, title, content, path, toolName })),
  [{
    id: "call_read",
    kind: "tool_call",
    title: "Tool: read_file",
    content: '{"path":"src/main.ts"}',
    path: "src/main.ts",
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline tool role message result",
  parseChatToolTimelineSseFrame(
    'data: {"choices":[{"message":{"role":"tool","tool_call_id":"call_read","name":"read_file","content":"file text"}}]}',
  ).map(({ id, kind, title, content, toolName }) => ({ id, kind, title, content, toolName })),
  [{
    id: "call_read",
    kind: "tool_result",
    title: "Tool: read_file",
    content: "file text",
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline anthropic content block tool use",
  parseChatToolTimelineSseFrame(
    'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_bash","name":"bash","input":{"command":"npm test"}}}',
  ).map(({ id, kind, title, content, toolName }) => ({ id, kind, title, content, toolName })),
  [{
    id: "toolu_bash",
    kind: "tool_call",
    title: "Tool: bash",
    content: '{"command":"npm test"}',
    toolName: "bash",
  }],
);

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
