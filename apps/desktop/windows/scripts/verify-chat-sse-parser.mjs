import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../shared/main/sseParser.ts", import.meta.url), "utf8");
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
  createChatContentNormalizer,
  createChatToolTimelineAccumulator,
  isCompletionDoneFrame,
  parseAgentLogSseFrame,
  parseAgentInputRequestSseFrame,
  parseAgentRunSseFrame,
  parseAgentRunSseFileEvents,
  parseChatReasoningSseFrame,
  parseChatSseErrorFrame,
  parseChatToolTimelineSseFrame,
  parseChatSseFrame,
  parseStructuredConversationSseFrame,
  parseCompletionSseFrame,
  parseProviderErrorAnalyticsSseFrame,
  parseProviderStatusSseFrame,
  parseProviderUsageAnalyticsSseFrame,
} = module.exports;

assertDeepEqual(
  "structured conversation named event",
  parseStructuredConversationSseFrame('event: drsai.event\ndata: {"version":2,"type":"turn.started","turnId":"turn-1","sequence":1,"dedupeKey":"turn-1:1:turn.started","timestamp":"2026-07-17T00:00:00Z","source":"gateway"}'),
  {
    version: 2,
    type: "turn.started",
    turnId: "turn-1",
    sequence: 1,
    dedupeKey: "turn-1:1:turn.started",
    timestamp: "2026-07-17T00:00:00Z",
    source: "gateway",
  },
);
assertDeepEqual(
  "invalid structured conversation event",
  parseStructuredConversationSseFrame('event: drsai.event\ndata: {"version":1,"type":"turn.started"}'),
  null,
);

const tagged = createChatContentNormalizer();
assertDeepEqual("tagged text prefix", tagged.pushContent("Answer <thi"), { text: ["Answer "], reasoning: [] });
assertDeepEqual("cross-chunk thinking open", tagged.pushContent("nk>first"), { text: [], reasoning: ["first"] });
assertDeepEqual("cross-chunk thinking close", tagged.pushContent(" thought</think>Final"), {
  text: ["Final"],
  reasoning: [" thought"],
});
assertDeepEqual("tagged finish", tagged.finish(), { text: [], reasoning: [] });

const multipleThinking = createChatContentNormalizer();
const multipleResult = multipleThinking.pushContent("<think>one</think>A<think>two</think>B");
assertDeepEqual("multiple thinking stays separate from text", multipleResult, {
  text: ["A", "B"],
  reasoning: ["one", "two"],
});

const escapedThinking = createChatContentNormalizer();
assertDeepEqual("escaped thinking tags", escapedThinking.pushContent("&lt;think&gt;hidden&lt;/think&gt;shown"), {
  text: ["shown"],
  reasoning: ["hidden"],
});

const nativeReasoning = createChatContentNormalizer();
assertDeepEqual("native reasoning first delta", nativeReasoning.pushNativeReasoning("native thought"), "native thought");
assertDeepEqual("native reasoning duplicate delta", nativeReasoning.pushNativeReasoning("native thought"), "");
assertDeepEqual("native reasoning suppresses duplicated tagged reasoning", nativeReasoning.pushContent("<think>native thought</think>answer"), {
  text: ["answer"],
  reasoning: [],
});

const unclosedThinking = createChatContentNormalizer();
assertDeepEqual("unclosed thinking stream", unclosedThinking.pushContent("<think>unfinished"), {
  text: [],
  reasoning: ["unfinished"],
});
assertDeepEqual("unclosed thinking finish", unclosedThinking.finish(), { text: [], reasoning: [] });

const unavailableModelError = parseChatSseErrorFrame('event: error\ndata: {"error":{"code":"MODEL_UNAVAILABLE","message":"Model is unavailable","retryable":false}}');
if (!unavailableModelError || unavailableModelError.code !== "MODEL_UNAVAILABLE" || unavailableModelError.retryable) {
  throw new Error("MODEL_UNAVAILABLE must remain a non-retryable stream error.");
}

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
  "gateway thinking delta is not chat content",
  parseChatSseFrame('data: {"choices":[{"delta":{"role":"thinking","content":"hidden reasoning"}}]}'),
  [],
);
assertDeepEqual(
  "gateway thinking delta is reasoning",
  parseChatReasoningSseFrame('data: {"choices":[{"delta":{"role":"thinking","content":"hidden reasoning"}}]}'),
  { title: "Model reasoning", content: "hidden reasoning", level: "DEBUG", content_type: "reasoning" },
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
  "native agent input request",
  parseAgentInputRequestSseFrame('event: agent.input_request\ndata: {"type":"input_request","input_type":"approval","prompt":"Continue?"}'),
  { version: 1, requestId: "", prompt: "Continue?", inputType: "approval" },
);
assertDeepEqual(
  "v1 choice input request",
  parseAgentInputRequestSseFrame('event: agent.input_request\ndata: {"version":1,"request_id":"input-1","chat_id":"chat-1","run_id":"run-1","input_type":"choice","prompt":"Select","options":[{"id":"a","label":"Option A","value":"A"}],"default":"A","allow_custom":true,"timeout_at":"2026-07-29T13:00:00Z"}'),
  {
    version: 1,
    requestId: "input-1",
    chatId: "chat-1",
    runId: "run-1",
    prompt: "Select",
    inputType: "choice",
    options: [{ id: "a", label: "Option A", value: "A" }],
    defaultValue: "A",
    allowCustom: true,
    timeoutAt: "2026-07-29T13:00:00Z",
  },
);
assertDeepEqual(
  "legacy value-only choice option",
  parseAgentInputRequestSseFrame('event: agent.input_request\ndata: {"version":1,"request_id":"input-2","input_type":"choice","prompt":"Select","options":[{"value":"continue","label":"Continue"}]}'),
  {
    version: 1,
    requestId: "input-2",
    prompt: "Select",
    inputType: "choice",
    options: [{ id: "continue", label: "Continue", value: "continue" }],
  },
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
  "Gemini text part content",
  parseChatSseFrame('data: {"candidates":[{"content":{"parts":[{"text":"gemini "},{"text":"text"}]}}]}'),
  ["gemini text"],
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
  "Gemini thought text part is status only",
  parseChatSseFrame('data: {"candidates":[{"content":{"parts":[{"text":"hidden reasoning","thought":true},{"text":"visible answer"}]}}]}'),
  ["visible answer"],
);
assertDeepEqual(
  "Gemini thought text part status",
  parseChatReasoningSseFrame('data: {"candidates":[{"content":{"parts":[{"text":"hidden reasoning","thought":true},{"text":"visible answer"}]}}]}'),
  { title: "Model reasoning", content: "hidden reasoning", level: "DEBUG", content_type: "reasoning" },
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
assertDeepEqual(
  "Gemini finish metadata lifecycle is status only",
  parseChatSseFrame('data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":11,"totalTokenCount":18}}'),
  [],
);
assertDeepEqual(
  "Gemini finish metadata lifecycle status",
  parseProviderStatusSseFrame('data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":11,"totalTokenCount":18}}'),
  { title: "Provider stream", content: "Gemini stream finished. finish_reason=STOP input_tokens=7 output_tokens=11 total_tokens=18", level: "DEBUG", content_type: "provider_status" },
);
assertDeepEqual(
  "Gemini finish metadata lifecycle usage analytics",
  parseProviderUsageAnalyticsSseFrame('data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":11,"totalTokenCount":18},"metadata":{"secret":"do-not-store"}}'),
  {
    provider: "google_gemini",
    eventName: "generateContent.stream",
    status: "STOP",
    summary: "Gemini stream finished. finish_reason=STOP input_tokens=7 output_tokens=11 total_tokens=18",
    usage: { inputTokens: 7, outputTokens: 11, totalTokens: 18 },
  },
);
assertDeepEqual("done sentinel", parseChatSseFrame("data: [DONE]"), []);
assert.throws(
  () => parseChatSseFrame('data: {"error":{"code":"upstream_timeout","message":"Worker timed out","retryable":true},"request_id":"req-ddf-1","invoke_id":"42"}'),
  (error) => error?.code === "upstream_timeout"
    && error?.retryable === true
    && error?.message === "Worker timed out (request_id: req-ddf-1, invoke_id: 42)",
);
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
try {
  parseChatSseFrame('event: error\ndata: {"error":{"code":429,"message":"Quota exhausted","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"30s"}]},"metadata":{"secret":"do-not-store"}}');
  throw new Error("Gemini provider error did not throw");
} catch (error) {
  if (error.name !== "ChatSseError" || error.code !== "RESOURCE_EXHAUSTED" || error.message !== "Quota exhausted" || error.retryable !== true) {
    throw error;
  }
}
assertDeepEqual(
  "Gemini provider error analytics",
  parseProviderErrorAnalyticsSseFrame('event: error\ndata: {"error":{"code":429,"message":"Quota exhausted","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"30s"}]},"metadata":{"secret":"do-not-store"}}'),
  {
    provider: "google_gemini",
    eventName: "error",
    code: "RESOURCE_EXHAUSTED",
    message: "Quota exhausted",
    retryable: true,
    summary: "Gemini stream error. code=RESOURCE_EXHAUSTED message=Quota exhausted retryable=true",
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
  "remote worker metadata step queued",
  parseChatToolTimelineSseFrame(
    'data: {"choices":[{"delta":{}}],"metadata":{"event_type":"step","step_id":"step-0001","title":"Host response","status":"queued","content":"Waiting to start"}}',
  ).map(({ id, kind, title, status, content }) => ({ id, kind, title, status, content })),
  [{
    id: "step-0001",
    kind: "log",
    title: "Host response",
    status: "started",
    content: "Waiting to start",
  }],
);
assertDeepEqual(
  "remote worker metadata step completed",
  parseChatToolTimelineSseFrame(
    'data: {"choices":[{"delta":{}}],"metadata":{"event_type":"step","step_id":"step-0001","title":"Host response","status":"completed","content":"Completed"}}',
  ).map(({ id, kind, title, status, content }) => ({ id, kind, title, status, content })),
  [{
    id: "step-0001",
    kind: "tool_result",
    title: "Host response",
    status: "completed",
    content: "Completed",
  }],
);
assertDeepEqual(
  "remote worker metadata tool start",
  parseChatToolTimelineSseFrame(
    'data: {"choices":[{"delta":{}}],"metadata":{"chat_id":"tool-thread","event_type":"tool","status":"in_progress","tool":{"id":"tool-worker-health-0001","name":"worker_health_check","phase":"start"}}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "tool-worker-health-0001",
    kind: "tool_call",
    title: "Tool: worker_health_check",
    status: "running",
    content: undefined,
    toolName: "worker_health_check",
  }],
);
assertDeepEqual(
  "remote worker metadata tool result",
  parseChatToolTimelineSseFrame(
    'data: {"choices":[{"delta":{}}],"metadata":{"chat_id":"tool-thread","event_type":"tool","status":"completed","tool":{"id":"tool-worker-health-0001","name":"worker_health_check","phase":"result","result":{"status":"ok","agent":"drsai_v3_test"}}}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "tool-worker-health-0001",
    kind: "tool_result",
    title: "Tool: worker_health_check",
    status: "completed",
    content: '{"status":"ok","agent":"drsai_v3_test"}',
    toolName: "worker_health_check",
  }],
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
  "tool timeline Gemini functionCall part",
  parseChatToolTimelineSseFrame(
    'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read_file","args":{"path":"src/main.ts"}}}]}}]}',
  ).map(({ kind, title, content, path, toolName }) => ({ kind, title, content, path, toolName })),
  [{
    kind: "tool_call",
    title: "Tool: read_file",
    content: '{"path":"src/main.ts"}',
    path: "src/main.ts",
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline Gemini functionResponse part",
  parseChatToolTimelineSseFrame(
    'data: {"candidates":[{"content":{"parts":[{"functionResponse":{"name":"read_file","response":{"content":"file text"}}}]}}]}',
  ).map(({ kind, title, status, content, toolName }) => ({ kind, title, status, content, toolName })),
  [{
    kind: "tool_result",
    title: "Tool: read_file",
    status: "completed",
    content: '{"content":"file text"}',
    toolName: "read_file",
  }],
);
assertDeepEqual(
  "tool timeline Gemini executableCode part",
  parseChatToolTimelineSseFrame(
    'data: {"candidates":[{"content":{"parts":[{"executableCode":{"language":"PYTHON","code":"print(42)"}}]}}]}',
  ).map(({ kind, title, status, content, toolName }) => ({ kind, title, status, content, toolName })),
  [{
    kind: "tool_call",
    title: "Tool: code_execution",
    status: undefined,
    content: '{"language":"PYTHON","code":"print(42)"}',
    toolName: "code_execution",
  }],
);
assertDeepEqual(
  "tool timeline Gemini codeExecutionResult part",
  parseChatToolTimelineSseFrame(
    'data: {"candidates":[{"content":{"parts":[{"codeExecutionResult":{"outcome":"OUTCOME_OK","output":"42"}}]}}]}',
  ).map(({ kind, title, status, content, toolName }) => ({ kind, title, status, content, toolName })),
  [{
    kind: "tool_result",
    title: "Tool: code_execution",
    status: "completed",
    content: '{"outcome":"OUTCOME_OK","output":"42"}',
    toolName: "code_execution",
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
assertDeepEqual(
  "tool timeline anthropic server web search tool use",
  parseChatToolTimelineSseFrame(
    'event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"server_tool_use","id":"srv_web_1","name":"web_search","input":{"query":"OpenDrSai release checklist"}}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "srv_web_1",
    kind: "tool_call",
    title: "Tool: web_search",
    status: "started",
    content: '{"query":"OpenDrSai release checklist"}',
    toolName: "web_search",
  }],
);
assertDeepEqual(
  "tool timeline anthropic web search tool result",
  parseChatToolTimelineSseFrame(
    'data: {"content":[{"type":"web_search_tool_result","tool_use_id":"srv_web_1","content":[{"type":"web_search_result","title":"OpenDrSai Windows release","url":"https://example.test/release","page_age":"1 day","encrypted_content":"do-not-store"}]}]}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "srv_web_1",
    kind: "tool_result",
    title: "Tool result: srv_web_1",
    status: "completed",
    content: '[{"type":"web_search_result","title":"OpenDrSai Windows release","url":"https://example.test/release","page_age":"1 day"}]',
    toolName: undefined,
  }],
);
assertDeepEqual(
  "tool timeline anthropic structured tool_result content",
  parseChatToolTimelineSseFrame(
    'data: {"content":[{"type":"tool_result","tool_use_id":"toolu_json","is_error":false,"content":[{"type":"json","json":{"patched":2,"files":["src/main.ts"]},"encrypted_content":"do-not-store"}]}]}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "toolu_json",
    kind: "tool_result",
    title: "Tool result: toolu_json",
    status: "completed",
    content: '{"type":"json","json":{"patched":2,"files":["src/main.ts"]}}',
    toolName: undefined,
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
  "OpenAI Responses reasoning output item is status only",
  parseChatSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":1,"item":{"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"Reviewed permissions and file scope."}],"encrypted_content":"do-not-store"}}',
  ),
  [],
);
assertDeepEqual(
  "tool timeline OpenAI Responses reasoning output item",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":1,"item":{"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"Reviewed permissions and file scope.","encrypted_content":"do-not-store"}],"encrypted_content":"do-not-store"}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "rs_1",
    kind: "log",
    title: "Model reasoning",
    status: "completed",
    content: '{"summary":[{"type":"summary_text","text":"Reviewed permissions and file scope."}]}',
    toolName: undefined,
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
  "tool timeline OpenAI Responses built-in web search detail payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":1,"item":{"type":"web_search_call","id":"ws_detail_1","status":"completed","query":"OpenDrSai Windows release","search_context":{"country":"US","city":"Chicago","encrypted_content":"do-not-store"},"user_location":{"type":"approximate","country":"US"},"domains":["docs.example.test"],"allowed_domains":["docs.example.test"],"blocked_domains":["ads.example.test"],"web_search_results":[{"title":"Release checklist","url":"https://docs.example.test/release?token=visible-fixture","snippet":"signed runtime package","encrypted_content":"nested-secret"}]}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "ws_detail_1",
    kind: "tool_call",
    title: "Tool: web_search",
    status: "completed",
    content: '{"query":"OpenDrSai Windows release","web_search_results":[{"title":"Release checklist","url":"https://docs.example.test/release?token=visible-fixture","snippet":"signed runtime package"}],"search_context":{"country":"US","city":"Chicago"},"user_location":{"type":"approximate","country":"US"},"domains":["docs.example.test"],"allowed_domains":["docs.example.test"],"blocked_domains":["ads.example.test"]}',
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
    content: '{"input":"print(42)","outputs":[{"type":"logs","logs":"42"}]}',
    toolName: "code_interpreter",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses built-in file search payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":3,"item":{"type":"file_search_call","id":"fs_1","status":"in_progress","queries":["release notes","runtime update"],"results":[{"file_id":"file_123","filename":"docs/release.md"}]}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "fs_1",
    kind: "tool_call",
    title: "Tool: file_search",
    status: "running",
    content: '{"queries":["release notes","runtime update"],"results":[{"file_id":"file_123","filename":"docs/release.md"}]}',
    toolName: "file_search",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses built-in file search detail payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":3,"item":{"type":"file_search_call","id":"fs_detail_1","status":"completed","queries":["approval center"],"vector_store_ids":["vs_release"],"filters":{"type":"eq","key":"repo","value":"drsai","encrypted_content":"do-not-store"},"ranking_options":{"ranker":"auto","score_threshold":0.42},"max_num_results":5,"results":[{"file_id":"file_456","filename":"docs/chatbar.md","score":0.92,"attributes":{"section":"approval","encrypted_content":"nested-secret"}}]}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "fs_detail_1",
    kind: "tool_call",
    title: "Tool: file_search",
    status: "completed",
    content: '{"queries":["approval center"],"results":[{"file_id":"file_456","filename":"docs/chatbar.md","score":0.92,"attributes":{"section":"approval"}}],"vector_store_ids":["vs_release"],"filters":{"type":"eq","key":"repo","value":"drsai"},"ranking_options":{"ranker":"auto","score_threshold":0.42},"max_num_results":5}',
    toolName: "file_search",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses built-in MCP approval request payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":4,"item":{"type":"mcp_approval_request","id":"mcp_approval_1","status":"in_progress","server_label":"github","name":"create_pull_request","arguments":{"title":"Runtime update","draft":true}}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "mcp_approval_1",
    kind: "tool_call",
    title: "Tool: mcp_approval",
    status: "running",
    content: '{"server_label":"github","name":"create_pull_request","arguments":{"title":"Runtime update","draft":true}}',
    toolName: "mcp_approval",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses built-in MCP approval response payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":4,"item":{"type":"mcp_approval_response","id":"mcp_approval_response_1","status":"completed","approval_request_id":"mcp_approval_1","approve":false,"reason":"User rejected repository write","encrypted_content":"do-not-store"}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "mcp_approval_response_1",
    kind: "tool_result",
    title: "Tool: mcp_approval_response",
    status: "completed",
    content: '{"approval_request_id":"mcp_approval_1","approve":false,"reason":"User rejected repository write"}',
    toolName: "mcp_approval_response",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses built-in MCP call output payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":5,"item":{"type":"mcp_call","id":"mcp_call_1","status":"completed","server_label":"github","name":"search_issues","arguments":{"q":"label:bug"},"output":[{"title":"Crash on launch","url":"https://example.test/issues/1"}],"approval_request_id":"mcp_approval_1"}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "mcp_call_1",
    kind: "tool_call",
    title: "Tool: search_issues",
    status: "completed",
    content: '{"server_label":"github","name":"search_issues","arguments":{"q":"label:bug"},"output":[{"title":"Crash on launch","url":"https://example.test/issues/1"}],"approval_request_id":"mcp_approval_1"}',
    toolName: "search_issues",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses built-in encrypted payload stripping",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":5,"item":{"type":"mcp_call","id":"mcp_call_secure","status":"completed","server_label":"docs","name":"read_doc","output":{"title":"Release notes","encrypted_content":"do-not-store","metadata":{"page":3,"encrypted_content":"nested-secret"}},"approval_request_id":"mcp_approval_secure"}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "mcp_call_secure",
    kind: "tool_call",
    title: "Tool: read_doc",
    status: "completed",
    content: '{"server_label":"docs","name":"read_doc","output":{"title":"Release notes","metadata":{"page":3}},"approval_request_id":"mcp_approval_secure"}',
    toolName: "read_doc",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses built-in MCP list tools payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":6,"item":{"type":"mcp_list_tools","id":"mcp_tools_1","status":"completed","server_label":"github","tools":[{"name":"search_issues","description":"Search issue metadata"},{"name":"create_pull_request","input_schema":{"type":"object","required":["title"]}}]}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "mcp_tools_1",
    kind: "tool_call",
    title: "Tool: mcp_list_tools",
    status: "completed",
    content: '{"server_label":"github","tools":[{"name":"search_issues","description":"Search issue metadata"},{"name":"create_pull_request","input_schema":{"type":"object","required":["title"]}}]}',
    toolName: "mcp_list_tools",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses built-in image generation payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":7,"item":{"type":"image_generation_call","id":"img_1","status":"completed","prompt":"OpenDrSai release splash","size":"1024x1024","quality":"high","output_format":"png","background":"transparent","result":"https://example.test/generated.png"}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "img_1",
    kind: "tool_call",
    title: "Tool: image_generation",
    status: "completed",
    content: '{"prompt":"OpenDrSai release splash","result":"https://example.test/generated.png","size":"1024x1024","quality":"high","output_format":"png","background":"transparent"}',
    toolName: "image_generation",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses computer call action safety payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":8,"item":{"type":"computer_call","id":"computer_call_1","status":"in_progress","action":{"type":"click","x":240,"y":180},"pending_safety_checks":[{"code":"browser_navigation","message":"Review before clicking external page"}]}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "computer_call_1",
    kind: "tool_call",
    title: "Tool: computer",
    status: "running",
    content: '{"action":{"type":"click","x":240,"y":180},"pending_safety_checks":[{"code":"browser_navigation","message":"Review before clicking external page"}]}',
    toolName: "computer",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses computer call output payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":9,"item":{"type":"computer_call_output","call_id":"computer_1","output":{"type":"computer_screenshot","image_url":"https://example.test/screenshot.png"},"acknowledged_safety_checks":[{"code":"browser_navigation","message":"User reviewed navigation request"}]}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "computer_1",
    kind: "tool_result",
    title: "Tool result: computer_1",
    status: "completed",
    content: '{"output":{"type":"computer_screenshot","image_url":"https://example.test/screenshot.png"},"acknowledged_safety_checks":[{"code":"browser_navigation","message":"User reviewed navigation request"}]}',
    toolName: undefined,
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses custom tool call payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":10,"item":{"type":"custom_tool_call","id":"custom_call_1","call_id":"custom_1","status":"in_progress","name":"local_shell","input":"npm run verify:chat-sse"}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "custom_call_1",
    kind: "tool_call",
    title: "Tool: local_shell",
    status: "running",
    content: "npm run verify:chat-sse",
    toolName: "local_shell",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses custom tool output payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":11,"item":{"type":"custom_tool_call_output","call_id":"custom_1","output":{"exit_code":0,"stdout":"Chat SSE parser verification passed.","encrypted_content":"do-not-store"}}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "custom_1",
    kind: "tool_result",
    title: "Tool result: custom_1",
    status: "completed",
    content: '{"output":{"exit_code":0,"stdout":"Chat SSE parser verification passed."},"call_id":"custom_1"}',
    toolName: undefined,
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses local shell call payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":12,"item":{"type":"local_shell_call","id":"shell_call_1","status":"in_progress","command":"npm run verify:chat-sse","action":{"type":"exec","command":"npm run verify:chat-sse","encrypted_content":"do-not-store"}}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "shell_call_1",
    kind: "tool_call",
    title: "Tool: local_shell",
    status: "running",
    content: '{"action":{"type":"exec","command":"npm run verify:chat-sse"},"command":"npm run verify:chat-sse"}',
    toolName: "local_shell",
  }],
);
assertDeepEqual(
  "tool timeline OpenAI Responses local shell output payload",
  parseChatToolTimelineSseFrame(
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":13,"item":{"type":"local_shell_call_output","call_id":"shell_call_1","status":"completed","output":{"exit_code":0,"stdout":"Chat SSE parser verification passed.","metadata":{"duration_ms":42,"encrypted_content":"nested-secret"},"encrypted_content":"do-not-store"},"stderr":""}}',
  ).map(({ id, kind, title, status, content, toolName }) => ({ id, kind, title, status, content, toolName })),
  [{
    id: "shell_call_1",
    kind: "tool_result",
    title: "Tool: local_shell",
    status: "completed",
    content: '{"output":{"exit_code":0,"stdout":"Chat SSE parser verification passed.","metadata":{"duration_ms":42}},"stderr":""}',
    toolName: "local_shell",
  }],
);

if (!isCompletionDoneFrame("event: done\ndata: [DONE]")) {
  throw new Error("done frame detector did not detect [DONE]");
}
if (!isCompletionDoneFrame('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"metadata":{"chat_id":"thread-1"}}')) {
  throw new Error("done frame detector did not detect OpenAI finish_reason");
}
if (!isCompletionDoneFrame('data: {"choices":[{"delta":{}}],"metadata":{"event_type":"terminal","status":"completed","chat_id":"thread-1"}}')) {
  throw new Error("done frame detector did not detect worker terminal metadata");
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
