export interface ChatSseChoice {
  delta?: {
    content?: string;
    tool_call?: unknown;
    tool_calls?: unknown;
    content_block?: unknown;
  };
  message?: {
    content?: string;
    role?: string;
    name?: string;
    tool_call_id?: string;
    tool_call?: unknown;
    tool_calls?: unknown;
  };
}

export interface ChatSsePayload {
  error?: string | { message?: string; code?: string; retryable?: boolean };
  type?: string;
  response?: {
    status?: string;
    error?: string | { message?: string; code?: string; type?: string; retryable?: boolean };
    incomplete_details?: {
      reason?: string;
    };
  };
  role?: string;
  content?: unknown;
  output?: unknown;
  item?: unknown;
  delta?: unknown;
  content_block?: unknown;
  choices?: ChatSseChoice[];
  file_event?: unknown;
  file_events?: unknown;
  tool_call?: unknown;
  tool_calls?: unknown;
  tool_event?: unknown;
  tool_events?: unknown;
  metadata?: {
    file_event?: unknown;
    file_events?: unknown;
    tool_call?: unknown;
    tool_calls?: unknown;
    tool_event?: unknown;
    tool_events?: unknown;
  };
}

export class ChatSseError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    public retryable = false,
  ) {
    super(message);
    this.name = "ChatSseError";
  }
}

export interface AgentLogSsePayload {
  title?: string;
  content?: string;
  level?: string;
  content_type?: string;
}

export interface AgentInputRequestSsePayload {
  prompt: string;
  inputType: "text_input" | "approval";
}

export interface ProviderUsageAnalyticsEvent {
  provider: "openai_responses" | "anthropic" | "google_gemini";
  eventName: string;
  status?: string;
  stopReason?: string;
  summary: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface ProviderErrorAnalyticsEvent {
  provider: "openai_responses" | "anthropic" | "google_gemini";
  eventName: string;
  code?: string;
  message: string;
  retryable: boolean;
  summary: string;
}

export interface ChatToolTimelineEvent {
  id: string;
  kind: "tool_call" | "tool_result" | "log" | "diff" | "artifact";
  title: string;
  status?: "started" | "running" | "completed" | "failed";
  content?: string;
  toolName?: string;
  path?: string;
  timestamp?: string;
  level?: string;
}

interface ToolArgumentStreamState {
  argumentsText: string;
  id?: string;
  toolName?: string;
}

export interface ChatToolTimelineAccumulator {
  parseFrame(frame: string): ChatToolTimelineEvent[];
}

export function parseCompletionSseFrame(frame: string): string[] {
  const payload = getSseData(frame);

  if (!payload || payload === "[DONE]") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }

  const structuredError = readChatSseError(parsed);
  if (structuredError) {
    throw new ChatSseError(
      structuredError.message,
      structuredError.code,
      structuredError.retryable,
    );
  }

  const value = parsed as ChatSsePayload;
  const content = value.choices?.[0]?.delta?.content ?? value.choices?.[0]?.message?.content ?? "";
  if (content) return [content];

  return readProviderTextDeltas(parsed, getSseEventName(frame));
}

export function parseAgentLogSseFrame(frame: string): AgentLogSsePayload | null {
  if (getSseEventName(frame) !== "agent.log") return null;

  const payload = getSseData(frame);
  if (!payload || payload === "[DONE]") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as AgentLogSsePayload;
  const content = typeof value.content === "string" ? value.content.trim() : "";
  if (!content) return null;

  return {
    title: typeof value.title === "string" ? value.title : undefined,
    content,
    level: typeof value.level === "string" ? value.level : undefined,
    content_type: typeof value.content_type === "string" ? value.content_type : undefined,
  };
}

export function parseAgentInputRequestSseFrame(frame: string): AgentInputRequestSsePayload | null {
  if (getSseEventName(frame) !== "agent.input_request") return null;
  const payload = getSseData(frame);
  if (!payload || payload === "[DONE]") return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
    if (!prompt) return null;
    return { prompt, inputType: parsed.input_type === "approval" ? "approval" : "text_input" };
  } catch {
    return null;
  }
}

export function parseChatReasoningSseFrame(frame: string): AgentLogSsePayload | null {
  const payload = getSseData(frame);
  if (!payload || payload === "[DONE]") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const content = readProviderReasoningDelta(parsed, getSseEventName(frame));
  if (!content) return null;
  return {
    title: "Model reasoning",
    content,
    level: "DEBUG",
    content_type: "reasoning",
  };
}

export function parseProviderStatusSseFrame(frame: string): AgentLogSsePayload | null {
  const payload = getSseData(frame);
  if (!payload || payload === "[DONE]") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const content = readProviderStatusSummary(parsed, getSseEventName(frame));
  if (!content) return null;
  return {
    title: "Provider stream",
    content,
    level: "DEBUG",
    content_type: "provider_status",
  };
}

export function parseProviderUsageAnalyticsSseFrame(frame: string): ProviderUsageAnalyticsEvent | null {
  const payload = getSseData(frame);
  if (!payload || payload === "[DONE]") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const summary = readProviderStatusSummary(parsed, getSseEventName(frame));
  if (!summary) return null;

  const record = readObject(parsed);
  if (!record) return null;
  const rawEventName = getSseEventName(frame) || readString(record.type);
  const type = readString(record.type).toLowerCase();
  const response = readObject(record.response);
  const message = readObject(record.message);
  const delta = readObject(record.delta);
  const usage = readObject(record.usage) || readObject(response?.usage) || readObject(message?.usage) || readObject(record.usageMetadata);
  const provider = inferProviderUsageProvider(type, rawEventName, record);
  if (!provider) return null;
  const eventName = rawEventName || (provider === "google_gemini" ? "generateContent.stream" : "");

  const status =
    provider === "google_gemini"
      ? readGeminiFinishReason(record) || readString(record.status) || type || eventName
      : readString(response?.status) ||
        readString(record.status) ||
        (provider === "openai_responses" ? type.replace(/^response\./, "") : "") ||
        (provider === "anthropic" ? type || eventName : "");
  const stopReason = provider === "anthropic"
    ? readString(delta?.stop_reason) || readString(record.stop_reason) || readString(message?.stop_reason)
    : "";
  return {
    provider,
    eventName,
    ...(status ? { status } : {}),
    ...(stopReason ? { stopReason } : {}),
    summary,
    usage: readTokenUsageNumbers(usage),
  };
}

export function parseProviderErrorAnalyticsSseFrame(frame: string): ProviderErrorAnalyticsEvent | null {
  const payload = getSseData(frame);
  if (!payload || payload === "[DONE]") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const record = readObject(parsed);
  if (!record) return null;
  const eventName = getSseEventName(frame) || readString(record.type);
  const type = readString(record.type).toLowerCase();
  const provider = inferProviderErrorProvider(type, eventName, record);
  if (!provider) return null;

  const structuredError = readChatSseError(parsed);
  if (!structuredError) return null;
  const message = structuredError.message.trim();
  if (!message) return null;
  const code = structuredError.code?.trim();
  const summary = compactStatusParts([
    readProviderErrorSummaryLabel(provider),
    code ? `code=${code}` : "",
    `message=${message}`,
    structuredError.retryable ? "retryable=true" : "retryable=false",
  ]);
  return {
    provider,
    eventName,
    ...(code ? { code } : {}),
    message,
    retryable: structuredError.retryable,
    summary,
  };
}

export function parseChatToolTimelineSseFrame(frame: string): ChatToolTimelineEvent[] {
  return collectChatToolTimelineCandidates(frame).flatMap(({ item, eventName, index }) =>
    normalizeToolTimelineEvent(item, eventName, index),
  );
}

export function createChatToolTimelineAccumulator(): ChatToolTimelineAccumulator {
  const argumentStreams = new Map<string, ToolArgumentStreamState>();
  return {
    parseFrame(frame: string): ChatToolTimelineEvent[] {
      return collectChatToolTimelineCandidates(frame, { includeProviderDeltas: true }).flatMap(({ item, eventName, index }) =>
        normalizeToolTimelineEvent(
          accumulateToolArgumentFragments(item, argumentStreams),
          eventName,
          index,
        ),
      );
    },
  };
}

function collectChatToolTimelineCandidates(
  frame: string,
  options: { includeProviderDeltas?: boolean } = {},
): Array<{ item: unknown; eventName: string; index: number }> {
  const payload = getSseData(frame);
  if (!payload || payload === "[DONE]") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  const value = parsed as ChatSsePayload;
  const eventName = getSseEventName(frame);
  const candidates = [
    ...normalizeUnknownItems(value.tool_call),
    ...normalizeUnknownItems(value.tool_calls),
    ...normalizeUnknownItems(value.tool_event),
    ...normalizeUnknownItems(value.tool_events),
    ...normalizeUnknownItems(value.metadata?.tool_call),
    ...normalizeUnknownItems(value.metadata?.tool_calls),
    ...normalizeUnknownItems(value.metadata?.tool_event),
    ...normalizeUnknownItems(value.metadata?.tool_events),
    ...extractChoiceToolCandidates(value.choices),
    ...extractProviderToolCandidates(parsed),
  ];
  if (/^(?:tool\.progress|tool\.call|tool\.result|agent\.tool|tool)$/i.test(eventName)) {
    candidates.push(parsed);
  }
  if (options.includeProviderDeltas && isProviderToolDeltaEnvelope(value, eventName)) {
    candidates.push(parsed);
  }

  return candidates.map((item, index) => ({ item, eventName, index }));
}

export function isCompletionDoneFrame(frame: string): boolean {
  return frame
    .split(/\r?\n/)
    .some((line) => line.startsWith("data:") && line.slice(5).trim() === "[DONE]");
}

export const parseChatSseFrame = parseCompletionSseFrame;
export const parseAgentRunSseFrame = parseCompletionSseFrame;

export interface AgentRunSseFileEvent {
  action: "read" | "create" | "modify" | "delete" | "rename" | "patch" | "artifact";
  path: string;
  name?: string;
  hash?: string;
  diff?: string;
  source?: string;
  targetPath?: string;
  timestamp?: string;
}

export function parseAgentRunSseFileEvents(frame: string): AgentRunSseFileEvent[] {
  const payload = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!payload || payload === "[DONE]") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  const value = parsed as ChatSsePayload;
  return [
    ...normalizeFileEvents(value.file_event),
    ...normalizeFileEvents(value.file_events),
    ...normalizeFileEvents(value.metadata?.file_event),
    ...normalizeFileEvents(value.metadata?.file_events),
  ];
}

function normalizeFileEvents(value: unknown): AgentRunSseFileEvent[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const action = normalizeAction(record.action);
    const path = typeof record.path === "string" ? record.path : "";
    if (!action || !path.trim()) return [];
    return [{
      action,
      path: path.trim(),
      name: typeof record.name === "string" ? record.name : undefined,
      hash: typeof record.hash === "string" ? record.hash : undefined,
      diff: typeof record.diff === "string" ? record.diff : undefined,
      source: typeof record.source === "string" ? record.source : undefined,
      targetPath: typeof record.targetPath === "string" ? record.targetPath : undefined,
      timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
    }];
  });
}

function normalizeUnknownItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function extractChoiceToolCandidates(choices: ChatSseChoice[] | undefined): unknown[] {
  if (!choices?.length) return [];
  return choices.flatMap((choice) => {
    const items = [
      ...normalizeUnknownItems(choice.delta?.tool_call),
      ...normalizeUnknownItems(choice.delta?.tool_calls),
      ...normalizeUnknownItems(choice.delta?.content_block),
      ...normalizeUnknownItems(choice.message?.tool_call),
      ...normalizeUnknownItems(choice.message?.tool_calls),
    ];
    if (isToolLikeRecord(choice.message)) items.push(choice.message);
    return items;
  });
}

function extractProviderToolCandidates(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const contentBlock = readObject(record.content_block);
  const itemRecord = readObject(record.item);
  const items = [
    ...normalizeUnknownItems(
      contentBlock && record.index !== undefined
        ? { ...contentBlock, index: record.index }
        : record.content_block,
    ),
    ...normalizeUnknownItems(
      itemRecord && record.output_index !== undefined
        ? { ...itemRecord, output_index: record.output_index }
        : record.item,
    ),
    ...normalizeUnknownItems(record.output),
  ];
  const delta = record.delta;
  if (isToolLikeRecord(delta)) items.push(delta);
  for (const contentItem of normalizeUnknownItems(record.content)) {
    if (isToolLikeRecord(contentItem)) items.push(contentItem);
  }
  for (const candidate of normalizeUnknownItems(record.candidates)) {
    const candidateRecord = readObject(candidate);
    const candidateContent = readObject(candidateRecord?.content);
    for (const part of normalizeUnknownItems(candidateContent?.parts)) {
      if (isToolLikeRecord(part)) items.push(part);
    }
  }
  return items;
}

function isProviderToolDeltaEnvelope(value: ChatSsePayload, eventName: string): boolean {
  const type = readString(value.type).toLowerCase();
  const normalizedEventName = eventName.toLowerCase();
  if (
    type === "response.function_call_arguments.delta" ||
    normalizedEventName === "response.function_call_arguments.delta" ||
    type === "function_call_arguments_delta"
  ) {
    return readRawString(value.delta) !== "";
  }
  if (type !== "content_block_delta" && eventName.toLowerCase() !== "content_block_delta") {
    return false;
  }
  const delta = readObject(value.delta);
  return readString(delta?.type).toLowerCase() === "input_json_delta" ||
    readRawString(delta?.partial_json) !== "";
}

function isToolLikeRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const type = readString(record.type).toLowerCase();
  const role = readString(record.role).toLowerCase();
  return Boolean(
    readString(record.tool_call_id) ||
    readString(record.call_id) ||
    readString(record.tool_use_id) ||
    readString(record.toolName) ||
    readString(record.tool_name) ||
    readString(record.tool) ||
    readString(record.function_name) ||
    readString(readObject(record.function)?.name) ||
    Boolean(readObject(record.functionCall)) ||
    Boolean(readObject(record.functionResponse)) ||
    Boolean(readObject(record.executableCode)) ||
    Boolean(readObject(record.codeExecutionResult)) ||
    type === "tool_use" ||
    type === "tool_result" ||
    type === "function_call" ||
    type === "custom_tool_call" ||
    type === "custom_tool_call_output" ||
    type === "function_result" ||
    type === "function_call_output" ||
    isProviderBuiltinToolType(type) ||
    type === "server_tool_call" ||
    type === "server_tool_use" ||
    type === "server_tool_result" ||
    type === "web_search_tool_result" ||
    type === "computer_call_output" ||
    type === "local_shell_call_output" ||
    role === "tool",
  );
}

function accumulateToolArgumentFragments(
  value: unknown,
  streams: Map<string, ToolArgumentStreamState>,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  rememberProviderToolUse(record, streams);
  const openAiResponseDelta = accumulateOpenAiResponseArgumentDelta(record, streams);
  if (openAiResponseDelta) return openAiResponseDelta;
  const providerDelta = accumulateProviderInputJsonDelta(record, streams);
  if (providerDelta) return providerDelta;

  const functionRecord = readObject(record.function);
  const argumentFragment = readRawString(functionRecord?.arguments);
  if (!argumentFragment) return value;

  const streamKey = record.index !== undefined
    ? `index:${readString(record.index)}`
    : readString(record.id) || readString(record.tool_call_id);
  if (!streamKey) return value;

  const incomingId = readString(record.id) || readString(record.tool_call_id);
  const previous = streams.get(streamKey);
  const shouldReset = Boolean(previous?.id && incomingId && previous.id !== incomingId);
  const nextState: ToolArgumentStreamState = {
    argumentsText: `${shouldReset ? "" : previous?.argumentsText ?? ""}${argumentFragment}`,
    id: incomingId || (shouldReset ? undefined : previous?.id),
    toolName: readString(functionRecord?.name) || (shouldReset ? undefined : previous?.toolName),
  };
  streams.set(streamKey, nextState);

  return {
    ...record,
    id: nextState.id || readString(record.id),
    function: {
      ...(functionRecord ?? {}),
      name: nextState.toolName || readString(functionRecord?.name),
      arguments: nextState.argumentsText,
    },
  };
}

function rememberProviderToolUse(
  record: Record<string, unknown>,
  streams: Map<string, ToolArgumentStreamState>,
): void {
  const type = readString(record.type).toLowerCase();
  if (type !== "tool_use" && type !== "server_tool_call" && type !== "server_tool_use" && type !== "function_call") return;
  const streamKeys = [
    record.index !== undefined ? `index:${readString(record.index)}` : "",
    record.output_index !== undefined ? `output_index:${readString(record.output_index)}` : "",
    readString(record.id) ? `id:${readString(record.id)}` : "",
  ].filter(Boolean);
  for (const streamKey of streamKeys) {
    const previous = streams.get(streamKey);
    streams.set(streamKey, {
      argumentsText: previous?.argumentsText ?? readRawString(record.arguments),
      id: readString(record.id) || readString(record.call_id) || previous?.id,
      toolName: readString(record.name) || readString(record.tool) || previous?.toolName,
    });
  }
}

function accumulateOpenAiResponseArgumentDelta(
  record: Record<string, unknown>,
  streams: Map<string, ToolArgumentStreamState>,
): unknown | null {
  const type = readString(record.type).toLowerCase();
  if (type !== "response.function_call_arguments.delta" && type !== "function_call_arguments_delta") {
    return null;
  }
  const argumentFragment = readRawString(record.delta);
  if (!argumentFragment) return null;

  const streamKey = readString(record.item_id)
    ? `id:${readString(record.item_id)}`
    : record.output_index !== undefined
      ? `output_index:${readString(record.output_index)}`
      : "";
  if (!streamKey) return null;

  const previous = streams.get(streamKey);
  const nextState: ToolArgumentStreamState = {
    argumentsText: `${previous?.argumentsText ?? ""}${argumentFragment}`,
    id: previous?.id || readString(record.item_id),
    toolName: previous?.toolName,
  };
  streams.set(streamKey, nextState);

  return {
    id: nextState.id || `response-arguments-${streamKey}`,
    type: "function_call",
    name: nextState.toolName,
    arguments: nextState.argumentsText,
  };
}

function accumulateProviderInputJsonDelta(
  record: Record<string, unknown>,
  streams: Map<string, ToolArgumentStreamState>,
): unknown | null {
  const type = readString(record.type).toLowerCase();
  const delta = readObject(record.delta);
  const deltaType = readString(delta?.type).toLowerCase();
  const partialJson = readRawString(delta?.partial_json);
  if (type !== "content_block_delta" && deltaType !== "input_json_delta" && !partialJson) {
    return null;
  }
  if (!partialJson) return null;

  const streamKey = record.index !== undefined
    ? `index:${readString(record.index)}`
    : readString(record.id) || readString(record.tool_call_id);
  if (!streamKey) return null;

  const previous = streams.get(streamKey);
  const nextState: ToolArgumentStreamState = {
    argumentsText: `${previous?.argumentsText ?? ""}${partialJson}`,
    id: previous?.id || readString(record.id) || readString(record.tool_call_id),
    toolName: previous?.toolName || readString(record.name) || readString(record.tool),
  };
  streams.set(streamKey, nextState);

  return {
    id: nextState.id || `input-json-${streamKey}`,
    type: "tool_use",
    name: nextState.toolName,
    input: nextState.argumentsText,
  };
}

function normalizeToolTimelineEvent(
  value: unknown,
  eventName: string,
  index: number,
): ChatToolTimelineEvent[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const functionRecord = readObject(record.function);
  const geminiFunctionCall = readObject(record.functionCall);
  const geminiFunctionResponse = readObject(record.functionResponse);
  const geminiExecutableCode = readObject(record.executableCode);
  const geminiCodeExecutionResult = readObject(record.codeExecutionResult);
  const providerBuiltinToolName = readProviderBuiltinToolName(readString(record.type));
  const structuredInput =
    record.arguments ??
    functionRecord?.arguments ??
    geminiFunctionCall?.args ??
    geminiFunctionResponse?.response ??
    geminiExecutableCode ??
    geminiCodeExecutionResult ??
    record.input ??
    record.parameters ??
    record.params;
  const toolName =
    readString(record.toolName) ||
    readString(record.tool_name) ||
    readString(record.tool) ||
    readString(functionRecord?.name) ||
    readString(geminiFunctionCall?.name) ||
    readString(geminiFunctionResponse?.name) ||
    readString(record.function_name) ||
    (geminiExecutableCode || geminiCodeExecutionResult ? "code_execution" : "") ||
    (providerBuiltinToolName === "mcp_approval" ? providerBuiltinToolName : "") ||
    readString(record.name) ||
    providerBuiltinToolName;
  const providerResultId =
    readString(record.tool_call_id) ||
    readString(record.call_id) ||
    readString(record.tool_use_id);
  const path =
    readString(record.path) ||
    readString(record.file) ||
    readString(record.targetPath) ||
    readPathFromStructuredPayload(structuredInput);
  const kind = normalizeToolEventKind(record.kind, eventName, record);
  const title =
    readString(record.title) ||
    (toolName ? `Tool: ${toolName}` : "") ||
    (kind === "tool_result" && providerResultId ? `Tool result: ${providerResultId}` : "") ||
    readProviderReasoningItemTitle(record) ||
    (path ? `File: ${path}` : "") ||
    eventName ||
    "Tool event";
  const content =
    readString(record.content) ||
    readString(record.message) ||
    readString(record.output) ||
    readString(record.diff) ||
    readString(record.summary) ||
    readProviderServerToolContent(record) ||
    readProviderComputerOutputContent(record) ||
    readProviderCustomToolContent(record) ||
    readProviderContentText(record.content) ||
    readProviderStructuredContent(record.content) ||
    readProviderBuiltinToolContent(record) ||
    readProviderReasoningItemContent(record) ||
    readStructuredText(structuredInput) ||
    readStructuredText(record.action) ||
    readStructuredText(record.result) ||
    readStructuredText(record.observation) ||
    readStructuredText(record.error);
  if (!title && !content) return [];
  return [{
    id: readString(record.id) || providerResultId || `${eventName || "tool"}-${index}-${stableToolEventHash(`${title}:${content ?? ""}`)}`,
    kind,
    title: clampToolText(title, 180),
    status: normalizeToolEventStatus(record.status || record.state || inferToolEventStatus(record, kind, eventName)),
    content: content ? clampToolText(content, 2000) : undefined,
    toolName: toolName ? clampToolText(toolName, 140) : undefined,
    path: path ? clampToolText(path, 260) : undefined,
    timestamp: readString(record.timestamp) || readString(record.createdAt),
    level: readString(record.level),
  }];
}

function normalizeToolEventKind(
  rawKind: unknown,
  eventName: string,
  record: Record<string, unknown>,
): ChatToolTimelineEvent["kind"] {
  const kind = readString(rawKind).toLowerCase();
  const type = readString(record.type).toLowerCase();
  const role = readString(record.role).toLowerCase();
  if (kind === "tool_result" || kind === "result") return "tool_result";
  if (isProviderReasoningItemType(type)) return "log";
  if (readObject(record.functionResponse)) return "tool_result";
  if (readObject(record.codeExecutionResult)) return "tool_result";
  if (
    type === "tool_result" ||
    type === "function_result" ||
    type === "custom_tool_call_output" ||
    type === "function_call_output" ||
    type === "server_tool_result" ||
    type === "web_search_tool_result" ||
    type === "computer_call_output" ||
    type === "local_shell_call_output" ||
    type === "mcp_approval_response" ||
    role === "tool"
  ) return "tool_result";
  if (readObject(record.functionCall)) return "tool_call";
  if (readObject(record.executableCode)) return "tool_call";
  if (type === "tool_use" || type === "function_call" || type === "custom_tool_call" || type === "server_tool_call" || type === "server_tool_use" || isProviderBuiltinToolType(type)) return "tool_call";
  if ((readString(record.tool_call_id) || readString(record.call_id) || readString(record.tool_use_id)) &&
    (readString(record.content) || readProviderContentText(record.content) || readString(record.output))) return "tool_result";
  if (kind === "diff" || readString(record.diff)) return "diff";
  if (kind === "artifact") return "artifact";
  if (kind === "log") return "log";
  if (/result$/i.test(eventName)) return "tool_result";
  if (/progress|log/i.test(eventName)) return "log";
  return "tool_call";
}

function inferToolEventStatus(
  record: Record<string, unknown>,
  kind: ChatToolTimelineEvent["kind"],
  eventName: string,
): ChatToolTimelineEvent["status"] | undefined {
  const normalizedEventName = eventName.toLowerCase();
  if (record.is_error === true || record.error !== undefined) return "failed";
  if (isProviderReasoningItemType(readString(record.type).toLowerCase())) {
    if (normalizedEventName === "response.output_item.done") return "completed";
    if (normalizedEventName === "response.output_item.added") return "started";
  }
  if (kind === "tool_result") return "completed";
  if (
    kind === "tool_call" &&
    (
      normalizedEventName === "response.output_item.done" ||
      normalizedEventName === "content_block_stop"
    )
  ) return "completed";
  if (
    kind === "tool_call" &&
    (
      normalizedEventName === "response.output_item.added" ||
      normalizedEventName === "content_block_start"
    )
  ) return "started";
  return undefined;
}

function normalizeToolEventStatus(rawStatus: unknown): ChatToolTimelineEvent["status"] | undefined {
  const status = readString(rawStatus).toLowerCase();
  if (status === "started" || status === "running" || status === "completed" || status === "failed") return status;
  if (status === "error") return "failed";
  if (status === "done" || status === "complete" || status === "success" || status === "succeeded") return "completed";
  if (status === "pending" || status === "in_progress") return "running";
  return undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function readChatSseError(value: unknown): { message: string; code?: string; retryable: boolean } | null {
  const record = readObject(value);
  if (!record) return null;
  const directError = normalizeChatSseErrorPayload(record.error);
  if (directError) return directError;

  const response = readObject(record.response);
  const responseError = normalizeChatSseErrorPayload(response?.error);
  if (responseError) return responseError;

  const type = readString(record.type).toLowerCase();
  const status = readString(response?.status).toLowerCase();
  const incompleteDetails = readObject(response?.incomplete_details);
  const incompleteReason = readString(incompleteDetails?.reason);
  if ((type === "response.incomplete" || status === "incomplete") && incompleteReason) {
    return {
      message: `Model response incomplete: ${incompleteReason}`,
      code: incompleteReason,
      retryable: false,
    };
  }
  return null;
}

function normalizeChatSseErrorPayload(
  value: unknown,
): { message: string; code?: string; retryable: boolean } | null {
  if (!value) return null;
  if (typeof value === "string") {
    return { message: value, retryable: false };
  }
  const record = readObject(value);
  if (!record) return null;
  const message = readString(record.message) || "Model request failed.";
  const status = readString(record.status);
  const code = status || readString(record.code) || readString(record.type) || undefined;
  return {
    message,
    code,
    retryable: record.retryable === true || isRetryableGoogleErrorStatus(status),
  };
}

function readRawString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readProviderContentText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const textParts = value.flatMap((item) => {
    const record = readObject(item);
    if (!record) return [];
    const text = readString(record.text) || readString(record.content);
    return text ? [text] : [];
  });
  return textParts.join("\n").trim();
}

function readProviderStructuredContent(value: unknown): string {
  const contentItems = normalizeUnknownItems(value).flatMap((item) => {
    const record = readObject(item);
    if (!record) return [];
    const payload: Record<string, unknown> = {};
    for (const key of [
      "type",
      "name",
      "id",
      "title",
      "url",
      "page_age",
      "error_code",
      "json",
      "data",
      "input",
      "output",
      "result",
    ]) {
      if (record[key] !== undefined) {
        payload[key] = stripEncryptedContent(record[key]);
      }
    }
    return Object.keys(payload).length ? [payload] : [];
  });
  return contentItems.length ? readStructuredText(contentItems.length === 1 ? contentItems[0] : contentItems) : "";
}

function readProviderServerToolContent(record: Record<string, unknown>): string {
  const type = readString(record.type).toLowerCase();
  if (type !== "web_search_tool_result") return "";
  const results = normalizeUnknownItems(record.content).flatMap((item) => {
    const itemRecord = readObject(item);
    if (!itemRecord) return [];
    const result: Record<string, unknown> = {};
    for (const key of ["type", "title", "url", "page_age", "error_code"]) {
      if (itemRecord[key] !== undefined) {
        result[key] = stripEncryptedContent(itemRecord[key]);
      }
    }
    return Object.keys(result).length ? [result] : [];
  });
  return results.length ? readStructuredText(results) : "";
}

function readProviderComputerOutputContent(record: Record<string, unknown>): string {
  const type = readString(record.type).toLowerCase();
  if (type !== "computer_call_output") return "";
  const payload: Record<string, unknown> = {};
  for (const key of [
    "output",
    "acknowledged_safety_checks",
    "pending_safety_checks",
  ]) {
    if (record[key] !== undefined) {
      payload[key] = stripEncryptedContent(record[key]);
    }
  }
  return Object.keys(payload).length ? readStructuredText(payload) : "";
}

function readProviderCustomToolContent(record: Record<string, unknown>): string {
  const type = readString(record.type).toLowerCase();
  if (type !== "custom_tool_call_output") return "";
  const payload: Record<string, unknown> = {};
  for (const key of [
    "input",
    "output",
    "call_id",
    "name",
  ]) {
    if (record[key] !== undefined) {
      payload[key] = stripEncryptedContent(record[key]);
    }
  }
  return Object.keys(payload).length ? readStructuredText(payload) : "";
}

function stripEncryptedContent(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripEncryptedContent(item));
  }
  const record = readObject(value);
  if (!record) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === "encrypted_content") continue;
    sanitized[key] = stripEncryptedContent(item);
  }
  return sanitized;
}

function isProviderReasoningItemType(type: string): boolean {
  return type === "reasoning" || type === "reasoning_summary";
}

function readProviderReasoningItemTitle(record: Record<string, unknown>): string {
  return isProviderReasoningItemType(readString(record.type).toLowerCase()) ? "Model reasoning" : "";
}

function readProviderReasoningItemContent(record: Record<string, unknown>): string {
  if (!isProviderReasoningItemType(readString(record.type).toLowerCase())) return "";
  const payload: Record<string, unknown> = {};
  const summary = readProviderReasoningSummary(record.summary);
  const content = readProviderReasoningSummary(record.content);
  const text = readString(record.text);
  if (summary.length) payload.summary = summary;
  if (content.length) payload.content = content;
  if (text) payload.text = text;
  return Object.keys(payload).length ? readStructuredText(payload) : "";
}

function readProviderReasoningSummary(value: unknown): Array<Record<string, unknown>> {
  return normalizeUnknownItems(value).flatMap((item) => {
    const record = readObject(item);
    if (!record) return [];
    const summary: Record<string, unknown> = {};
    const type = readString(record.type);
    const text = readString(record.text);
    if (type) summary.type = type;
    if (text) summary.text = text;
    return Object.keys(summary).length ? [summary] : [];
  });
}

function isProviderBuiltinToolType(type: string): boolean {
  return type === "web_search_call" ||
    type === "file_search_call" ||
    type === "code_interpreter_call" ||
    type === "computer_call" ||
    type === "local_shell_call" ||
    type === "local_shell_call_output" ||
    type === "mcp_call" ||
    type === "mcp_list_tools" ||
    type === "mcp_approval_request" ||
    type === "mcp_approval_response" ||
    type === "image_generation_call";
}

function readProviderBuiltinToolName(type: string): string {
  if (!isProviderBuiltinToolType(type)) return "";
  return type.replace(/_call_output$/, "").replace(/_call$/, "").replace(/_request$/, "");
}

function readProviderBuiltinToolContent(record: Record<string, unknown>): string {
  const type = readString(record.type).toLowerCase();
  if (!isProviderBuiltinToolType(type)) return "";
  const payload: Record<string, unknown> = {};
  if ((type === "computer_call" || type === "local_shell_call") && record.action !== undefined) {
    payload.action = stripEncryptedContent(record.action);
  }
  for (const key of [
    "command",
    "query",
    "queries",
    "results",
    "web_search_results",
    "search_context",
    "user_location",
    "domains",
    "allowed_domains",
    "blocked_domains",
    "vector_store_ids",
    "filters",
    "ranking_options",
    "max_num_results",
    "server_label",
    "serverLabel",
    "name",
    "tool",
    "tool_name",
    "tools",
    "arguments",
    "output",
    "exit_code",
    "stdout",
    "stderr",
    "approval_request_id",
    "approve",
    "approved",
    "decision",
    "reason",
    "input",
    "outputs",
    "acknowledged_safety_checks",
    "pending_safety_checks",
    "container_id",
    "prompt",
    "result",
    "size",
    "quality",
    "output_format",
    "background",
  ]) {
    if (record[key] !== undefined) {
      payload[key] = stripEncryptedContent(record[key]);
    }
  }
  return Object.keys(payload).length ? readStructuredText(payload) : "";
}

function readProviderTextDeltas(value: unknown, eventName: string): string[] {
  const record = readObject(value);
  if (!record) return [];
  const type = readString(record.type).toLowerCase();
  const normalizedEventName = eventName.toLowerCase();
  const delta = readObject(record.delta);
  const deltaType = readString(delta?.type).toLowerCase();
  const rawDelta = readRawString(record.delta);
  if (
    rawDelta &&
    (
      type === "response.output_text.delta" ||
      normalizedEventName === "response.output_text.delta" ||
      type === "output_text_delta"
    )
  ) {
    return [rawDelta];
  }
  if (
    (
      type === "content_block_delta" ||
      normalizedEventName === "content_block_delta" ||
      type === "text_delta" ||
      deltaType === "text_delta"
    ) &&
    deltaType !== "input_json_delta"
  ) {
    const text = readRawString(delta?.text) || readRawString(record.text);
    return text ? [text] : [];
  }
  const geminiText = readGeminiCandidateTextParts(record, false);
  if (geminiText) return [geminiText];
  return [];
}

function readProviderReasoningDelta(value: unknown, eventName: string): string {
  const record = readObject(value);
  if (!record) return "";
  const type = readString(record.type).toLowerCase();
  const normalizedEventName = eventName.toLowerCase();
  const delta = readObject(record.delta);
  const deltaType = readString(delta?.type).toLowerCase();
  const rawDelta = readRawString(record.delta);
  if (
    rawDelta &&
    (
      type === "response.reasoning_summary_text.delta" ||
      normalizedEventName === "response.reasoning_summary_text.delta" ||
      type === "response.reasoning_text.delta" ||
      normalizedEventName === "response.reasoning_text.delta" ||
      type === "reasoning_delta"
    )
  ) {
    return rawDelta.trim();
  }
  if (
    type === "thinking_delta" ||
    deltaType === "thinking_delta" ||
    deltaType === "reasoning_delta"
  ) {
    return (readRawString(delta?.thinking) || readRawString(delta?.text) || readRawString(record.thinking)).trim();
  }
  return readGeminiCandidateTextParts(record, true).trim();
}

function readGeminiCandidateTextParts(record: Record<string, unknown>, thoughtOnly: boolean): string {
  const textParts: string[] = [];
  for (const candidate of normalizeUnknownItems(record.candidates)) {
    const candidateRecord = readObject(candidate);
    const candidateContent = readObject(candidateRecord?.content);
    for (const part of normalizeUnknownItems(candidateContent?.parts)) {
      const partRecord = readObject(part);
      if (!partRecord || readObject(partRecord.functionCall) || readObject(partRecord.functionResponse)) continue;
      const isThought = partRecord.thought === true;
      if (thoughtOnly !== isThought) continue;
      const text = readRawString(partRecord.text);
      if (text) textParts.push(text);
    }
  }
  return textParts.join("").trim();
}

function readProviderStatusSummary(value: unknown, eventName: string): string {
  const record = readObject(value);
  if (!record) return "";
  const type = readString(record.type).toLowerCase();
  const normalizedEventName = eventName.toLowerCase();
  const response = readObject(record.response);
  const message = readObject(record.message);
  const delta = readObject(record.delta);
  const usage = readObject(record.usage) || readObject(response?.usage) || readObject(message?.usage);

  const responseStatus = readString(response?.status) || readString(record.status);
  if (
    type === "response.created" ||
    type === "response.in_progress" ||
    type === "response.completed" ||
    type === "response.queued" ||
    normalizedEventName === "response.created" ||
    normalizedEventName === "response.in_progress" ||
    normalizedEventName === "response.completed" ||
    normalizedEventName === "response.queued"
  ) {
    const state = responseStatus || type.replace(/^response\./, "") || normalizedEventName.replace(/^response\./, "");
    return compactStatusParts([
      `OpenAI Responses stream ${state}.`,
      readTokenUsageSummary(usage),
    ]);
  }

  if (type === "message_start" || normalizedEventName === "message_start") {
    return compactStatusParts([
      "Anthropic message started.",
      readTokenUsageSummary(usage),
    ]);
  }
  if (type === "message_delta" || normalizedEventName === "message_delta") {
    const stopReason = readString(delta?.stop_reason);
    return compactStatusParts([
      stopReason ? `Anthropic message delta stop_reason=${stopReason}.` : "Anthropic message delta.",
      readTokenUsageSummary(usage),
    ]);
  }
  if (type === "message_stop" || normalizedEventName === "message_stop") {
    return "Anthropic message stopped.";
  }

  const geminiFinishReason = readGeminiFinishReason(record);
  const geminiUsage = readObject(record.usageMetadata);
  if (geminiFinishReason || geminiUsage) {
    return compactStatusParts([
      "Gemini stream finished.",
      geminiFinishReason ? `finish_reason=${geminiFinishReason}` : "",
      readTokenUsageSummary(geminiUsage),
    ]);
  }

  return "";
}

function readTokenUsageSummary(usage: Record<string, unknown> | null): string {
  if (!usage) return "";
  const input = readString(usage.input_tokens) || readString(usage.prompt_tokens) || readString(usage.promptTokenCount);
  const output = readString(usage.output_tokens) || readString(usage.completion_tokens) || readString(usage.candidatesTokenCount);
  const total = readString(usage.total_tokens) || readString(usage.totalTokenCount);
  return compactStatusParts([
    input ? `input_tokens=${input}` : "",
    output ? `output_tokens=${output}` : "",
    total ? `total_tokens=${total}` : "",
  ], " ");
}

function readTokenUsageNumbers(usage: Record<string, unknown> | null): ProviderUsageAnalyticsEvent["usage"] {
  if (!usage) return {};
  return {
    ...readTokenUsageNumberField(usage.input_tokens, usage.prompt_tokens ?? usage.promptTokenCount, "inputTokens"),
    ...readTokenUsageNumberField(usage.output_tokens, usage.completion_tokens ?? usage.candidatesTokenCount, "outputTokens"),
    ...readTokenUsageNumberField(usage.total_tokens, usage.totalTokenCount, "totalTokens"),
  };
}

function readTokenUsageNumberField(
  primary: unknown,
  fallback: unknown,
  key: keyof ProviderUsageAnalyticsEvent["usage"],
): ProviderUsageAnalyticsEvent["usage"] {
  const raw = readString(primary) || readString(fallback);
  if (!raw) return {};
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? { [key]: Math.trunc(value) } : {};
}

function inferProviderUsageProvider(
  type: string,
  eventName: string,
  record: Record<string, unknown>,
): ProviderUsageAnalyticsEvent["provider"] | null {
  const normalizedEventName = eventName.toLowerCase();
  if (type.startsWith("response.") || normalizedEventName.startsWith("response.")) {
    return "openai_responses";
  }
  if (
    type === "message_start" ||
    type === "message_delta" ||
    type === "message_stop" ||
    normalizedEventName === "message_start" ||
    normalizedEventName === "message_delta" ||
    normalizedEventName === "message_stop"
  ) {
    return "anthropic";
  }
  if (readObject(record.usageMetadata) || readGeminiFinishReason(record)) {
    return "google_gemini";
  }
  return null;
}

function readGeminiFinishReason(record: Record<string, unknown>): string {
  for (const candidate of normalizeUnknownItems(record.candidates)) {
    const candidateRecord = readObject(candidate);
    const finishReason = readString(candidateRecord?.finishReason);
    if (finishReason) return finishReason;
  }
  return readString(record.finishReason);
}

function inferProviderErrorProvider(
  type: string,
  eventName: string,
  record: Record<string, unknown>,
): ProviderErrorAnalyticsEvent["provider"] | null {
  const normalizedEventName = eventName.toLowerCase();
  if (isGeminiErrorRecord(record, type, normalizedEventName)) {
    return "google_gemini";
  }
  if (
    type === "response.failed" ||
    type === "response.incomplete" ||
    normalizedEventName === "response.failed" ||
    normalizedEventName === "response.incomplete"
  ) {
    return "openai_responses";
  }
  if (
    type === "error" ||
    normalizedEventName === "error" ||
    normalizedEventName === "message_error"
  ) {
    return "anthropic";
  }
  return null;
}

function isGeminiErrorRecord(
  record: Record<string, unknown>,
  type: string,
  normalizedEventName: string,
): boolean {
  const error = readObject(record.error);
  if (!error) return false;
  const status = readString(error.status);
  if (status) return true;
  if (normalizedEventName.includes("generatecontent") || type.includes("generatecontent")) return true;
  return normalizeUnknownItems(error.details).some((detail) => {
    const detailRecord = readObject(detail);
    const detailType = readString(detailRecord?.["@type"]).toLowerCase();
    return detailType.includes("google.rpc") || detailType.includes("googleapis.com");
  });
}

function isRetryableGoogleErrorStatus(status: string): boolean {
  const normalized = status.toUpperCase();
  return normalized === "RESOURCE_EXHAUSTED" ||
    normalized === "UNAVAILABLE" ||
    normalized === "DEADLINE_EXCEEDED" ||
    normalized === "ABORTED";
}

function readProviderErrorSummaryLabel(provider: ProviderErrorAnalyticsEvent["provider"]): string {
  if (provider === "openai_responses") return "OpenAI Responses stream error.";
  if (provider === "google_gemini") return "Gemini stream error.";
  return "Anthropic stream error.";
}

function compactStatusParts(parts: string[], separator = " "): string {
  return parts.filter((part) => part.trim()).join(separator).trim();
}

function readStructuredText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return readString(value);
  if (!value || typeof value !== "object") return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function readPathFromStructuredPayload(value: unknown): string {
  const record = typeof value === "string" ? parseJsonObject(value) : readObject(value);
  if (!record) return "";
  return readString(record.path) || readString(record.file) || readString(record.targetPath);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    return readObject(JSON.parse(value));
  } catch {
    return null;
  }
}

function clampToolText(value: string, maxLength: number): string {
  return value.replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function stableToolEventHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizeAction(value: unknown): AgentRunSseFileEvent["action"] | null {
  if (value === "read" || value === "create" || value === "modify" || value === "delete" ||
    value === "rename" || value === "patch" || value === "artifact") {
    return value;
  }
  return null;
}

function getSseEventName(frame: string): string {
  return frame
    .split(/\r?\n/)
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim() ?? "";
}

function getSseData(frame: string): string {
  return frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
}
