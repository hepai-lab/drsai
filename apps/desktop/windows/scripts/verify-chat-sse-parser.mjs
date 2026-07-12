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
  createChatToolTimelineAccumulator,
  isCompletionDoneFrame,
  parseAgentLogSseFrame,
  parseAgentRunSseFrame,
  parseAgentRunSseFileEvents,
  parseChatReasoningSseFrame,
  parseChatToolTimelineSseFrame,
  parseChatSseFrame,
  parseCompletionSseFrame,
  parseProviderErrorAnalyticsSseFrame,
  parseProviderStatusSseFrame,
  parseProviderUsageAnalyticsSseFrame,
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
assertDeepEqual(
  "chat file patch event",
  parseAgentRunSseFileEvents('data: {"file_event":{"action":"patch","path":"src/app.ts","diff":"@@ -1 +1 @@\\n-old\\n+new","hash":"abc"}}'),
  [{ action: "patch", path: "src/app.ts", name: undefined, hash: "abc", diff: "@@ -1 +1 @@\n-old\n+new", source: undefined, targetPath: undefined, timestamp: undefined }],
);
assertDeepEqual(
  "OpenAI Responses output_text delta content",
  parseChatSseFrame('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"response text"}'),
  ["response text"],
);
assertDeepEqual(
  "Anthropic text delta content",
  parseChatSseFrame('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"anthropic text"}}'),
  ["anthropic text"],
);
assertDeepEqual(
  "OpenAI Responses reasoning summary delta is status only",
  parseChatSseFrame('event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"checked constraints"}'),
  [],
);
assertDeepEqual(
  "OpenAI Responses reasoning summary status",
  parseChatReasoningSseFrame('event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"checked constraints"}'),
  { title: "Model reasoning", content: "checked constraints", level: "DEBUG", content_type: "reasoning" },
);
assertDeepEqual(
  "Anthropic thinking delta is status only",
  parseChatSseFrame('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"compare options"}}'),
  [],
);
assertDeepEqual(
  "Anthropic thinking delta status",
  parseChatReasoningSseFrame('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"compare options"}}'),
  { title: "Model reasoning", content: "compare options", level: "DEBUG", content_type: "reasoning" },
);
assertDeepEqual(
  "OpenAI Responses completed lifecycle is status only",
  parseChatSseFrame('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":42,"output_tokens":17,"total_tokens":59}}}'),
  [],
);
assertDeepEqual(
  "OpenAI Responses completed lifecycle status",
  parseProviderStatusSseFrame('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":42,"output_tokens":17,"total_tokens":59}}}'),
  { title: "Provider stream", content: "OpenAI Responses stream completed. input_tokens=42 output_tokens=17 total_tokens=59", level: "DEBUG", content_type: "provider_status" },
);
assertDeepEqual(
  "OpenAI Responses completed lifecycle usage analytics",
  parseProviderUsageAnalyticsSseFrame('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":42,"output_tokens":17,"total_tokens":59},"metadata":{"secret":"do-not-store"}}}'),
  {
    provider: "openai_responses",
    eventName: "response.completed",
    status: "completed",
    summary: "OpenAI Responses stream completed. input_tokens=42 output_tokens=17 total_tokens=59",
    usage: { inputTokens: 42, outputTokens: 17, totalTokens: 59 },
  },
);
assertDeepEqual(
  "Anthropic message_delta lifecycle is status only",
  parseChatSseFrame('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":17}}'),
  [],
);
assertDeepEqual(
  "Anthropic message_delta lifecycle status",
  parseProviderStatusSseFrame('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":17}}'),
  { title: "Provider stream", content: "Anthropic message delta stop_reason=end_turn. output_tokens=17", level: "DEBUG", content_type: "provider_status" },
);
assertDeepEqual(
  "Anthropic message_delta lifecycle usage analytics",
  parseProviderUsageAnalyticsSseFrame('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":17}}'),
  {
    provider: "anthropic",
    eventName: "message_delta",
    status: "message_delta",
    stopReason: "end_turn",
    summary: "Anthropic message delta stop_reason=end_turn. output_tokens=17",
    usage: { outputTokens: 17 },
  },
);
assertDeepEqual("done sentinel", parseChatSseFrame("data: [DONE]"), []);
assertDeepEqual("malformed frame", parseChatSseFrame("data: not-json"), []);
try {
  parseChatSseFrame('data: {"error":{"code":"token_expired","message":"Session expired","retryable":true}}');
  throw new Error("structured model error did not throw");
} catch (error) {
  if (error.name !== "ChatSseError" || error.code !== "token_expired" || error.retryable !== true) {
    throw error;
  }
}
try {
  parseChatSseFrame('event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed","error":{"code":"rate_limit_exceeded","message":"Rate limit reached"}}}');
  throw new Error("OpenAI Responses failed error did not throw");
} catch (error) {
  if (error.name !== "ChatSseError" || error.code !== "rate_limit_exceeded" || error.message !== "Rate limit reached") {
    throw error;
  }
}
assertDeepEqual(
  "OpenAI Responses failed error analytics",
  parseProviderErrorAnalyticsSseFrame('event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed","error":{"code":"rate_limit_exceeded","message":"Rate limit reached"}},"metadata":{"secret":"do-not-store"}}'),
  {
    provider: "openai_responses",
    eventName: "response.failed",
    code: "rate_limit_exceeded",
    message: "Rate limit reached",
    retryable: false,
    summary: "OpenAI Responses stream error. code=rate_limit_exceeded message=Rate limit reached retryable=false",
  },
);
try {
  parseChatSseFrame('event: response.incomplete\ndata: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}');
  throw new Error("OpenAI Responses incomplete error did not throw");
} catch (error) {
  if (error.name !== "ChatSseError" || error.code !== "max_output_tokens" || !error.message.includes("max_output_tokens")) {
    throw error;
  }
}
assertDeepEqual(
  "OpenAI Responses incomplete error analytics",
  parseProviderErrorAnalyticsSseFrame('event: response.incomplete\ndata: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}'),
  {
    provider: "openai_responses",
    eventName: "response.incomplete",
    code: "max_output_tokens",
    message: "Model response incomplete: max_output_tokens",
    retryable: false,
    summary: "OpenAI Responses stream error. code=max_output_tokens message=Model response incomplete: max_output_tokens retryable=false",
  },
);
try {
  parseChatSseFrame('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Provider overloaded"}}');
  throw new Error("Anthropic provider error did not throw");
} catch (error) {
  if (error.name !== "ChatSseError" || error.code !== "overloaded_error" || error.message !== "Provider overloaded") {
    throw error;
  }
}
assertDeepEqual(
  "Anthropic provider error analytics",
  parseProviderErrorAnalyticsSseFrame('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Provider overloaded","retryable":true},"request":{"secret":"do-not-store"}}'),
  {
    provider: "anthropic",
    eventName: "error",
    code: "overloaded_error",
    message: "Provider overloaded",
    retryable: true,
    summary: "Anthropic stream error. code=overloaded_error message=Provider overloaded retryable=true",
  },
);
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
  "tool timeline openai responses function_call_output result",
  parseChatToolTimelineSseFrame(
    'data: {"output":[{"type":"function_call_output","call_id":"call_lookup","output":"{\\"ok\\":true}"}]}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "call_lookup",
    kind: "tool_result",
    title: "Tool result: call_lookup",
    status: "completed",
    content: '{"ok":true}',
    toolName: undefined,
  }],
);
assertDeepEqual(
  "tool timeline anthropic tool_result content array failure",
  parseChatToolTimelineSseFrame(
    'data: {"content":[{"type":"tool_result","tool_use_id":"toolu_bash","content":[{"type":"text","text":"stderr: failed"}],"is_error":true}]}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "toolu_bash",
    kind: "tool_result",
    title: "Tool result: toolu_bash",
    status: "failed",
    content: "stderr: failed",
    toolName: undefined,
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
const toolTimelineAccumulator = createChatToolTimelineAccumulator();
assertDeepEqual(
  "tool timeline streamed partial argument first frame",
  toolTimelineAccumulator.parseFrame(
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_stream","type":"function","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}',
  ).map(({ id, kind, title, content, path, toolName }) => ({ id, kind, title, content, path, toolName })),
  [{
    id: "call_stream",
    kind: "tool_call",
    title: "Tool: read_file",
    content: '{"pa',
    path: undefined,
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline streamed partial argument accumulation",
  toolTimelineAccumulator.parseFrame(
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"type":"function","function":{"arguments":"th\\":\\"src/main.ts\\"}"}}]}}]}',
  ).map(({ id, kind, title, content, path, toolName }) => ({ id, kind, title, content, path, toolName })),
  [{
    id: "call_stream",
    kind: "tool_call",
    title: "Tool: read_file",
    content: '{"path":"src/main.ts"}',
    path: "src/main.ts",
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline streamed partial argument reset on new id",
  toolTimelineAccumulator.parseFrame(
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_stream_next","type":"function","function":{"name":"list_files","arguments":"{\\"folder\\":\\"src\\"}"}}]}}]}',
  ).map(({ id, kind, title, content, path, toolName }) => ({ id, kind, title, content, path, toolName })),
  [{
    id: "call_stream_next",
    kind: "tool_call",
    title: "Tool: list_files",
    content: '{"folder":"src"}',
    path: undefined,
    toolName: "list_files",
  }],
);
const anthropicToolAccumulator = createChatToolTimelineAccumulator();
assertDeepEqual(
  "tool timeline anthropic tool use start seeds stream metadata",
  anthropicToolAccumulator.parseFrame(
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_read","name":"read_file","input":{}}}',
  ).map(({ id, kind, title, content, toolName }) => ({ id, kind, title, content, toolName })),
  [{
    id: "toolu_read",
    kind: "tool_call",
    title: "Tool: read_file",
    content: "{}",
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline anthropic input_json_delta first fragment",
  anthropicToolAccumulator.parseFrame(
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"pa"}}',
  ).map(({ id, kind, title, content, path, toolName }) => ({ id, kind, title, content, path, toolName })),
  [{
    id: "toolu_read",
    kind: "tool_call",
    title: "Tool: read_file",
    content: '{"pa',
    path: undefined,
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline anthropic input_json_delta accumulation",
  anthropicToolAccumulator.parseFrame(
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"th\\":\\"src/main.ts\\"}"}}',
  ).map(({ id, kind, title, content, path, toolName }) => ({ id, kind, title, content, path, toolName })),
  [{
    id: "toolu_read",
    kind: "tool_call",
    title: "Tool: read_file",
    content: '{"path":"src/main.ts"}',
    path: "src/main.ts",
    toolName: "read_file",
  }],
);
const openAiResponsesToolAccumulator = createChatToolTimelineAccumulator();
assertDeepEqual(
  "tool timeline OpenAI Responses function_call output item seeds stream metadata",
  openAiResponsesToolAccumulator.parseFrame(
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_read","call_id":"call_read","name":"read_file","arguments":""}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "fc_read",
    kind: "tool_call",
    title: "Tool: read_file",
    status: "started",
    content: undefined,
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses function_call_arguments delta first fragment",
  openAiResponsesToolAccumulator.parseFrame(
    'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"fc_read","output_index":0,"delta":"{\\"pa"}',
  ).map(({ id, kind, title, content, path, toolName }) => ({ id, kind, title, content, path, toolName })),
  [{
    id: "fc_read",
    kind: "tool_call",
    title: "Tool: read_file",
    content: '{"pa',
    path: undefined,
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses function_call_arguments delta accumulation",
  openAiResponsesToolAccumulator.parseFrame(
    'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"fc_read","output_index":0,"delta":"th\\":\\"src/main.ts\\"}"}',
  ).map(({ id, kind, title, content, path, toolName }) => ({ id, kind, title, content, path, toolName })),
  [{
    id: "fc_read",
    kind: "tool_call",
    title: "Tool: read_file",
    content: '{"path":"src/main.ts"}',
    path: "src/main.ts",
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses function_call output item done is completed",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_done","call_id":"call_done","name":"read_file","arguments":"{\\"path\\":\\"src/done.ts\\"}"}}',
  ).map(({ id, kind, title, status, content, path, toolName }) => ({ id, kind, title, status, content, path, toolName })),
  [{
    id: "fc_done",
    kind: "tool_call",
    title: "Tool: read_file",
    status: "completed",
    content: '{"path":"src/done.ts"}',
    path: "src/done.ts",
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses built-in web search call",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":1,"item":{"type":"web_search_call","id":"ws_1","status":"in_progress","action":{"type":"search","query":"OpenDrSai release checklist"}}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "ws_1",
    kind: "tool_call",
    title: "Tool: web_search",
    status: "running",
    content: '{"type":"search","query":"OpenDrSai release checklist"}',
    toolName: "web_search",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses built-in code interpreter done",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":2,"item":{"type":"code_interpreter_call","id":"ci_1","status":"completed","input":"print(42)","outputs":[{"type":"logs","logs":"42"}]}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "ci_1",
    kind: "tool_call",
    title: "Tool: code_interpreter",
    status: "completed",
    content: "print(42)",
    toolName: "code_interpreter",
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
