import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");

// Exercise the actual row factory, row render and memo/event contracts without
// Electron or a DOM dependency. Leaf components stay opaque; this test verifies
// the props delivered to them, not their own rendering/observer behavior.
const source = readFileSync(resolve(dirname(resolve(process.argv[2])), "../renderer/src/components/ChatWorkspace.tsx"), "utf8");
const between = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const row = between("const VirtualizedMessage = memo(", "\nfunction formatPickedFileMeta");
const map = between("renderedMessages.map((message, messageIndex)", "\n      </div>").trim().replace(/}$/, "");
const eventHook = between("function useEventCallback<", "\n}") + "\n}";
const comparator = between("function shallowArrayEqual(", "\nexport const ChatWorkspace");
const highlight = between("function highlightPlainText(", "\nfunction getPathName");
const eventBindings = between("  const messageEvents = {", "\n  async function submitWithAttachments");
const voiceBinding = between("  const messageVoicePlayback = useMemo(", "\n  const {");

const shallowEqual = (a: any, b: any) => Object.keys(a).length === Object.keys(b).length
  && Object.keys(a).every(k => Object.hasOwn(b, k) && Object.is(a[k], b[k]));
const node = (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } });
let slots: any[] = [];
let cursor = 0;
function memoValue(factory: () => any, deps: any[]) {
  const i = cursor++;
  if (!slots[i] || !shallowEqual(slots[i].deps, deps)) slots[i] = { deps, value: factory() };
  return slots[i].value;
}
const noop = () => {};
const scope: any = {
  React: { createElement: node, Fragment: "fragment" },
  memo: (render: any, compare = shallowEqual) => ({ render, compare }),
  useRef: (initial: any) => { const i = cursor++; return slots[i] ??= { current: initial }; },
  useCallback: (callback: any, deps: any[]) => memoValue(() => callback, deps),
  useMemo: memoValue,
  useState: (initial: any) => [initial, noop], useEffect: noop,
  virtualMessageHeightCache: new Map(), estimateVirtualMessageHeight: () => 220,
  getAssistantDisplayContent: (message: any) => message.content,
  getReasoningChatText: (text: string) => text,
  isVoiceCaptureActive: (phase: string) => phase === "recording",
  resolveVoiceSynthesisMode: (mode: string) => mode,
};
for (const name of ["MessageAttachmentBadge", "StructuredMessageParts", "StreamingStatus", "ChatMessageContent", "ChatErrorCard", "ChevronRight", "MessageActions", "UserMessageActions"]) scope[name] = name;
const program = `${eventHook}\n${comparator}\n${highlight}\n${row}\n
function buildRows() { return (${map}); }
function bindEvents() { ${eventBindings}; return messageEvents; }
function bindVoice() { ${voiceBinding}; return messageVoicePlayback; }
this.api = { VirtualizedMessage, buildRows, bindEvents, bindVoice, chatWorkspacePropsEqual, useEventCallback };`;
runInNewContext(ts.transpileModule(program, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText, scope);
const api = scope.api;
function renderHooks(fn: () => any, state: any[]) { slots = state; cursor = 0; return fn(); }
const bindingsState: any[] = [];
const voiceState: any[] = [];
Object.assign(scope, {
  renderedMessages: [], visibleMessages: [], messageListRef: { current: null },
  searchMatchSet: new Set(), activeMatchId: null, highlightedTurnId: null,
  language: "en", workspacePath: "/one", searchQuery: "",
  conversationResourceStates: {}, respondedInputRequests: new Set(), configuredCapabilityRequests: new Set(), runReproducibility: {},
  voicePlayback: { activeMessageId: null, phase: "idle", error: null, isAvailable: true, pause: noop, play: noop, resume: noop, stop: noop },
  showAnyVoiceCaptureBar: false, voiceTurnState: { phase: "idle" },
  voicePreferences: { playbackRate: 1, synthesisMode: "system", remoteTtsConsent: false, voiceName: "" }, activeRequestId: "stream", canChat: true,
});
const actions = ["startEditAndResend", "startEditUserMessage", "regenerateAssistant", "onRetryMessage", "onReportFeedback", "onRecoveryAction", "onDeleteMessage"];
for (const key of [...actions, "handleMarkdownLink", "openStructuredArtifact", "downloadStructuredArtifact", "openConversationResourceMenu", "openStructuredCitation", "respondToStructuredInteraction", "requestStructuredTextInput"]) scope[key] = noop;
function build() {
  scope.messageEvents = renderHooks(api.bindEvents, bindingsState);
  scope.messageVoicePlayback = renderHooks(api.bindVoice, voiceState);
  return api.buildRows();
}
function render(props: any) { return renderHooks(() => api.VirtualizedMessage.render(props), []); }
function descendants(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(descendants);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...descendants(tree.props?.children)];
}
function leaf(tree: any, type: string) { const found = descendants(tree).find(n => n.type === type); assert.ok(found, `missing ${type}`); return found.props; }
function text(tree: any): string {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree && typeof tree === "object") return text(tree.props?.children);
  return typeof tree === "string" ? tree : "";
}
const history = [
  { id: "user", role: "user", content: "alpha beta", attachments: [{ name: "file" }] },
  { id: "legacy", role: "assistant", content: "answer", inputRequest: { requestId: "request" } },
  { id: "structured", role: "assistant", content: "answer", runtimeRunId: "run", structuredTurn: { turnId: "turn", parts: [{ kind: "interaction" }], activities: [] } },
  { id: "failed", role: "assistant", content: "", replyFailed: true, errorPresentation: { actions: [] } },
];
scope.renderedMessages = [...history, { id: "live", role: "assistant", content: "token", streaming: true }];
scope.visibleMessages = scope.renderedMessages;
let previous = build();
const renders = previous.map(() => 1);
for (let i = 0; i < 200; i++) {
  scope.renderedMessages = [...history, { ...scope.renderedMessages.at(-1), content: `token ${i}` }];
  scope.visibleMessages = scope.renderedMessages;
  // The voice hook and upstream callbacks are commonly fresh on each token.
  scope.voicePlayback = { ...scope.voicePlayback };
  for (const action of actions) scope[action] = () => i;
  const next = build();
  next.forEach((n: any, index: number) => { if (!api.VirtualizedMessage.compare(previous[index].props, n.props)) renders[index]++; });
  previous = next;
}
assert.deepEqual(renders, [1, 1, 1, 1, 201], "tokens must only invalidate the streaming row");
function update(changes: any, index: number) {
  const old = build()[index].props;
  Object.assign(scope, changes);
  const next = build()[index].props;
  assert.equal(api.VirtualizedMessage.compare(old, next), false, `must update: ${Object.keys(changes)}`);
  return render(next);
}
let tree = update({ searchQuery: "alpha", searchMatchSet: new Set(["user"]), activeMatchId: "user" }, 0);
assert.match(tree.props.className, /search-match.*search-active/);
assert.equal(text(leaf(tree, "mark").children), "alpha");
tree = update({ searchQuery: "beta" }, 0);
assert.equal(text(leaf(tree, "mark").children), "beta", "query changes even if matched IDs do not");
tree = update({ activeMatchId: "legacy" }, 0);
assert.doesNotMatch(tree.props.className, /search-active/);
tree = update({ searchQuery: "", searchMatchSet: new Set() }, 0);
assert.equal(descendants(tree).filter(n => n.type === "mark").length, 0);
assert.doesNotMatch(tree.props.className, /search-match/);
tree = update({ highlightedTurnId: "turn" }, 2);
assert.match(tree.props.className, /structured-turn-focus/);
tree = update({ respondedInputRequests: new Set(["request"]) }, 1);
assert.match(text(tree), /Action handled/);
tree = update({ configuredCapabilityRequests: new Set(["capability"]) }, 2);
assert.ok(leaf(tree, "StructuredMessageParts").configuredCapabilityRequestIds.has("capability"));
assert.ok(leaf(tree, "StructuredMessageParts").respondedRequestIds.has("request"));
tree = update({ language: "zh" }, 1);
assert.match(text(tree), /操作已处理/);
assert.equal(leaf(tree, "MessageActions").zh, true);
tree = update({ workspacePath: "/two" }, 0);
assert.equal(leaf(tree, "MessageAttachmentBadge").workspacePath, "/two");
tree = update({ conversationResourceStates: { resource: "deleted" } }, 2);
assert.equal(leaf(tree, "StructuredMessageParts").resourceStates.resource, "deleted");
assert.equal(leaf(tree, "StructuredMessageParts").language, "zh");
assert.equal(leaf(tree, "StructuredMessageParts").workspacePath, "/two");
tree = update({ runReproducibility: { run: "full" } }, 2);
assert.equal(leaf(tree, "StructuredMessageParts").reproducibilityLevel, "full");
tree = update({ activeRequestId: null }, 1);
assert.equal(leaf(tree, "MessageActions").turnActionsDisabled, false);
tree = update({ showAnyVoiceCaptureBar: true }, 1);
assert.equal(leaf(tree, "MessageActions").playbackDisabled, true);
tree = update({ voicePlayback: { ...scope.voicePlayback, phase: "playing", activeMessageId: "legacy" } }, 1);
assert.equal(leaf(tree, "MessageActions").playback.phase, "playing");
for (const [key, value, leafKey] of [["playbackRate", 1.5, "playbackRate"], ["synthesisMode", "provider", "synthesisMode"], ["voiceName", "voice-two", "voiceName"]]) {
  tree = update({ voicePreferences: { ...scope.voicePreferences, [key]: value } }, 1);
  assert.equal(leaf(tree, "MessageActions")[leafKey], value);
}
update({ messageListRef: { current: null } }, 0);
const pinned = build()[0].props;
assert.equal(api.VirtualizedMessage.compare(pinned, { ...pinned, pinned: false }), false);
assert.equal(render({ ...pinned, pinned: false }).props["aria-hidden"], true);

// Cached row event props keep their identities but invoke new implementations.
const cached = build()[1].props;
for (const name of actions) {
  let called = false;
  scope[name] = () => { called = true; };
  const next = build()[1].props;
  assert.equal(next[name], cached[name]);
  cached[name]("legacy");
  assert.ok(called, `${name} uses the latest closure`);
}
tree = update({ onRetryMessage: undefined, onReportFeedback: undefined }, 3);
assert.equal(descendants(tree).filter(n => n.type === "button").length, 0, "optional actions disappear");
tree = update({ onDeleteMessage: undefined }, 0);
assert.equal(leaf(tree, "UserMessageActions").onDelete, undefined);
let interaction: any;
scope.respondToStructuredInteraction = (...args: any[]) => { interaction = args; };
leaf(render(build()[2].props), "StructuredMessageParts").onRespondInteraction("part", "response");
assert.deepEqual(interaction, ["turn", "part", "response"]);

assert.equal(api.chatWorkspacePropsEqual({ messages: history }, { messages: [...history] }), true);
assert.equal(api.chatWorkspacePropsEqual({ messages: history, onDeleteMessage: noop }, { messages: history, onDeleteMessage: () => {} }), false);
assert.equal(api.chatWorkspacePropsEqual({ messages: history, onDeleteMessage: noop }, { messages: history }), false);
assert.equal(api.chatWorkspacePropsEqual({ old: undefined }, { replacement: undefined }), false);
// Even with unchanged messages, fresh parent callbacks refresh the outer
// workspace. Its cached row props must still bail out AND call the new closure.
scope.onDeleteMessage = noop;
let parentProps = { messages: scope.renderedMessages, onDeleteMessage: scope.onDeleteMessage };
const cachedRows = build();
let callbackGeneration = -1;
for (let generation = 0; generation < 200; generation++) {
  const onDeleteMessage = () => { callbackGeneration = generation; };
  const nextParentProps = { ...parentProps, onDeleteMessage };
  assert.equal(api.chatWorkspacePropsEqual(parentProps, nextParentProps), false,
    "callback-only changes must refresh the outer workspace");
  scope.onDeleteMessage = onDeleteMessage;
  const nextRows = build();
  nextRows.forEach((row: any, index: number) => {
    assert.equal(api.VirtualizedMessage.compare(cachedRows[index].props, row.props), true,
      "callback-only workspace refreshes must not invalidate unchanged rows");
  });
  cachedRows[0].props.onDeleteMessage("user");
  assert.equal(callbackGeneration, generation, "cached row events must invoke the latest parent closure");
  parentProps = nextParentProps;
}
console.log("CHAT_WORKSPACE_MEMO_OK: search, interaction, language/resources, action freshness, 200-token history stability, 200 callback-only workspace refreshes");
