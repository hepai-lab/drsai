import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const workspace = readFileSync(join(root, "../../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const renderer = readFileSync(join(root, "../../shared/renderer/src/components/StructuredMessageParts.tsx"), "utf8");
const adapter = readFileSync(join(root, "../../shared/renderer/src/adapters/useDesktopChatAdapter.ts"), "utf8");
const app = readFileSync(join(root, "../../shared/renderer/src/App.tsx"), "utf8");
const debugPanel = readFileSync(join(root, "../../shared/renderer/src/components/DebugPanel.tsx"), "utf8");
const chatMain = readFileSync(join(root, "../../shared/main/chat.ts"), "utf8");
const threadsMain = readFileSync(join(root, "../../shared/main/threads.ts"), "utf8");
const css = readFileSync(join(root, "../../shared/renderer/src/styles.css"), "utf8");

assert.match(
  workspace,
  /structuredTurn\.parts\.length\s*\|\|\s*message\.structuredTurn\.activities\.length/,
  "activity-only assistant messages must render instead of falling back to No response content",
);
assert.match(renderer, /function StructuredActivityTimeline/, "structured activity timeline renderer is missing");
assert.match(renderer, /data-activity-count=\{turn\.activities\.length\}/, "chat must expose only an aggregate tool count");
assert.match(renderer, /在调试中查看详情/, "chat tool summary must direct detailed inspection to Debug");
assert.match(
  renderer,
  /function StructuredActivityDetails[\s\S]*turn\.activities\.slice\(window\.start, window\.end\)\.map\([\s\S]*formatActivitySummary/,
  "completed activity summaries must remain inside a bounded dedicated details surface",
);
assert.equal(
  (renderer.match(/turn\.activities\.map\(/g) ?? []).length,
  0,
  "raw activity iteration must never mount an unbounded activity collection",
);
assert.match(renderer, /PROCESS_ACTIVITY_WINDOW_SIZE/, "activity details must use the shared bounded window size");
assert.match(renderer, /ProcessWindowNavigation/, "all activity evidence must remain reachable through pagination");
assert.doesNotMatch(renderer, /activity\.output/, "raw tool output must not be rendered in the chat body");
assert.match(adapter, /appendStructuredActivity/, "tool timeline events must be upserted into the structured turn");
assert.match(
  adapter,
  /hydrateStructuredMessages[\s\S]*consolidateHydratedAssistantRuns\(hydrated\)[\s\S]*readPersistedRunId[\s\S]*mergeHydratedAssistantMessages/,
  "restoring a thread must consolidate assistant/reasoning/tool records from the same persisted run",
);
assert.match(
  adapter,
  /formatToolTimelineDebugLog\(toolTimeline\)/,
  "full tool event details must remain available in the Debug log",
);
assert.match(
  adapter,
  /createStructuredToolActivity\(state\.turnId, event\)[\s\S]*timestamp: event\.timestamp\?\.trim\(\) \|\| new Date\(\)\.toISOString\(\)/,
  "blank worker timestamps must be normalized and activity turn IDs must stay aligned",
);
assert.match(adapter, /appendStructuredActivityLog\(createStructuredToolActivity\(event\.requestId, toolTimeline\)\)/, "tool details must populate the Debug activity view");
assert.match(app, /setDebugViewRequest[\s\S]*view: "activity"/, "chat tool summaries must open the Debug activity view");
assert.match(debugPanel, /requestedView[\s\S]*setView\(requestedView\.view\)/, "Debug panel must honor activity-view requests");
assert.match(
  adapter,
  /firstUser\?\.content\.replace\(\/\[\\r\\n\]\+\/g, " "\)\.trim\(\)\.slice\(0, 48\)/,
  "multiline first messages must produce valid single-line thread titles",
);
assert.match(
  threadsMain,
  /title\.replace\(\/\[\\r\\n\\u2028\\u2029\]\+\/g, " "\)\.trim\(\)\.slice\(0, MAX_TITLE_CHARS\)/,
  "the main-process persistence boundary must normalize multiline thread titles",
);
assert.doesNotMatch(
  adapter,
  /structuredRequests\.current\.has\(event\.requestId\)[\s\S]{0,180}event\.type === "tool_timeline"/,
  "mixed structured status + tool timeline requests must not discard tool activity",
);
assert.ok(
  chatMain.indexOf("if (emitTimelineEvents(frame))") < chatMain.indexOf("const providerStatus = parseProviderStatusSseFrame(frame)"),
  "worker metadata tool/step frames must be emitted before generic provider status handling",
);
assert.match(css, /\.structured-activity-compact/, "compact tool activity summary has no visual styling");
assert.match(workspace, /data-testid="composer-agent-interaction"/, "pending agent input must replace the composer input surface");
assert.match(workspace, /activeInputRequest\.inputType === "approval"/, "composer does not render approval input");
assert.match(workspace, /activeInputRequest\.inputType === "confirmation"/, "composer does not render confirmation input");
assert.match(workspace, /activeInputRequest\.inputType === "choice"/, "composer does not render choice input");
assert.match(workspace, /interactionDraft/, "composer does not render free-text agent input");
assert.match(adapter, /inputRequest:\s*undefined[\s\S]*finalizeStructuredTurn/, "terminal events must clear persisted pending input");
assert.match(css, /\.chat-agent-input-request > div\s*\{\s*display:\s*none/, "message cards must not duplicate composer interaction controls");

console.log("Remote-agent tool/HIL UI verification passed (compact Debug summary, composer interaction controls, stable lifecycle state).");
