import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const renderer = readFileSync(join(root, "../shared/renderer/src/components/StructuredMessageParts.tsx"), "utf8");
const workspace = readFileSync(join(root, "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const adapter = readFileSync(join(root, "../shared/renderer/src/adapters/useDesktopChatAdapter.ts"), "utf8");
const app = readFileSync(join(root, "../shared/renderer/src/App.tsx"), "utf8");
const files = readFileSync(join(root, "../shared/renderer/src/components/files/FilesContextPanel.tsx"), "utf8");
const styles = readFileSync(join(root, "../shared/renderer/src/styles.css"), "utf8");

for (const kind of ["markdown", "reasoning", "progress", "artifact", "citation", "interaction", "subtask", "notice"]) {
  const present = kind === "notice"
    ? renderer.includes("return <NoticeItem")
    : renderer.includes(`part.kind === "${kind}"`) || renderer.includes(`kind: "${kind}"`);
  assert.ok(present, `Missing ${kind} renderer.`);
}
assert.equal(renderer.includes('part.kind === "tool"'), false, "Tool activity must not render in the conversation document.");
assert.ok(
  renderer.includes('part.kind === "progress"')
    && renderer.includes('items={progressParts}')
    && renderer.includes('items={reasoningParts}'),
  "Progress, including completed backend commentary, must render inside the process layer.",
);
assert.ok(
  renderer.includes('part.kind === "interaction"')
    && renderer.includes('part.status === "running" || part.status === "pending"'),
  "Resolved interactions must leave the transcript.",
);
assert.ok(
  renderer.includes("part.segments.filter")
    && renderer.includes("visibleSegments.map")
    && renderer.includes("分析摘要"),
  "User-visible reasoning summaries must render inside the process layer.",
);
assert.ok(renderer.includes('className="structured-run-status"') && renderer.includes("statusMeta"), "Run identity, status and elapsed time must share one status row.");
assert.ok(renderer.includes('className="structured-process"') && renderer.includes("processOpen"), "Process details must use one state-aware disclosure.");
assert.ok(
  renderer.includes('processOpen ? <div')
    && renderer.includes('data-testid="structured-process-content"'),
  "Collapsed completed process details must not mount their evidence body.",
);
assert.ok(
  renderer.includes("BoundedProcessSection")
    && renderer.includes("ProcessWindowNavigation")
    && renderer.includes("turn.activities.slice(window.start, window.end)"),
  "Large process and activity collections must use bounded, navigable windows.",
);
assert.ok(
  renderer.includes('<summary className="structured-run-status"')
    && renderer.includes('className="structured-run-actions"')
    && renderer.includes('className="structured-process-label"'),
  "Process disclosure must be merged into the run status row.",
);
assert.ok(renderer.includes('className="structured-interaction-layer"'), "Pending user interaction must have its own visible layer.");
assert.ok(renderer.includes('className="structured-result-layer"') && renderer.includes("最终回答"), "Final results must remain outside process details.");
assert.ok(renderer.includes("StructuredActivityDetails") && renderer.includes("操作与变更"), "Observable actions and file changes must be inspectable in the process layer.");
assert.ok(renderer.includes("respondedRequestIds") && renderer.includes("onRespondInteraction"), "Interaction parts must be actionable and idempotent.");
assert.ok(renderer.includes("onOpenArtifact") && renderer.includes("onOpenCitation"), "Artifacts and citations must route to contextual panels.");
assert.ok(renderer.includes("part.citationIds.map") && renderer.includes("focusPart(citation.id)"), "Markdown citations must locate stable citation cards.");
assert.ok(renderer.includes("part.markdownPartId") && renderer.includes("structured-citation-back"), "Citation cards must navigate back to the related markdown part.");
assert.ok(renderer.includes("data-artifact-id={part.artifactId}") && renderer.includes("data-status={part.status}"), "Artifact cards must expose stable identity and status.");
assert.ok(renderer.includes("<StructuredActivitySummary") && renderer.includes('activity.status === "pending" || activity.status === "running"'), "Active work must have a compact transcript footer.");
assert.ok(renderer.includes('activity.kind === "tool"') && renderer.includes("activity.toolName"), "Tool activity footer must show only the concise tool name.");
assert.ok(renderer.includes('turn.status !== "pending" && turn.status !== "running"'), "Activity footer must disappear when the turn ends.");
assert.ok(renderer.includes("formatRunDuration") && renderer.includes("startedAt ?? now"), "Active turns must expose a live elapsed duration.");
assert.ok(renderer.includes('durationMs < 1000') && renderer.includes('少于 1 秒'), "Sub-second runs must never be presented as 0 seconds.");
assert.equal(renderer.includes('className="structured-run-stop"'), false, "The transcript must not duplicate the Composer stop action.");

assert.ok(workspace.includes('message.role === "assistant" && message.structuredTurn'), "ChatWorkspace must prefer the V2 document.");
assert.ok(workspace.includes("<StructuredMessageParts"), "ChatWorkspace must render V2 parts directly.");
assert.ok(workspace.includes("onOpenDebug={onOpenDebug}"), "Compact activity must route details to the Debug panel.");
assert.ok(workspace.includes('messages.some((message) => message.streaming)'), "Elapsed duration must refresh for the entire streaming turn.");
assert.ok(workspace.includes("<StreamingStatus") && workspace.includes("已执行"), "Pre-output streaming state must expose elapsed time without a duplicate stop action.");
assert.ok(adapter.includes("const aborted = await desktopApi.abortChat(requestId)") && adapter.includes('event.type === "aborted" ? "cancelled" : "completed"'), "Composer stop must abort the runtime and settle structured streaming state.");
assert.ok(workspace.includes("!message.structuredTurn && message.reasoningContent"), "Legacy reasoning must only be a fallback.");
assert.ok(workspace.includes("!message.structuredTurn && message.inputRequest"), "Legacy interaction must only be a fallback.");
assert.ok(workspace.includes("onOpenWorkspaceArtifact"), "ChatWorkspace must expose the existing files-panel route.");
assert.ok(workspace.includes("isSafeWebUrl(part.url)"), "Structured web targets must use an HTTP(S) allowlist.");
assert.ok(
  adapter.includes('streaming: structuredTurn.status === "pending" || structuredTurn.status === "running"'),
  "Hydrated terminal turns must not retain a stale streaming indicator.",
);

assert.ok(app.includes('setActiveRightTab("files")') && app.includes("setFilesPanelFocusPath(path)"), "Artifact clicks must open the existing Files panel.");
assert.ok(app.includes('setActiveRightTab("browser")'), "Citation URLs must use the existing Browser panel.");
assert.ok(files.includes("focusPath") && files.includes("findNodeByPath(nodes, focusPath)"), "Files panel must focus the selected artifact.");

for (const className of ["structured-message-parts", "structured-run-status", "structured-process", "structured-interaction-layer", "structured-result-layer", "structured-progress", "structured-artifact", "structured-citation", "structured-notice", "structured-activity-summary"]) {
  assert.ok(styles.includes(`.${className}`), `Missing ${className} styles.`);
}
assert.ok(styles.includes(".structured-progress,") && !styles.includes(".structured-progress {\n  border:"), "Progress must remain a quiet text-level status.");

console.log("Structured message renderer verification passed (8 part kinds, OAEP four-layer output)." );
