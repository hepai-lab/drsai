import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const renderer = readFileSync(join(root, "../shared/renderer/src/components/StructuredMessageParts.tsx"), "utf8");
const presentation = readFileSync(join(root, "../shared/renderer/src/structuredProcessPresentation.ts"), "utf8");
const projection = readFileSync(join(root, "../shared/main/threadRuntimeProjection.ts"), "utf8");
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
assert.equal(renderer.includes('part.kind === "tool"'), false, "Tool activity must not render as a conversation part.");
assert.ok(renderer.includes("buildStructuredProcessPresentation") && presentation.includes("aggregateActivities") && presentation.includes("aggregateProgress"), "Process presentation must aggregate repeated actions and progress before rendering.");
assert.ok(renderer.includes('useState(turn.status === "error")') && !renderer.includes('useState(turn.status === "running"'), "Routine running turns must keep process evidence collapsed by default.");
assert.ok(renderer.includes('turn.status === "error" && previousTurnStatusRef.current !== "error"'), "New run failures must reveal process evidence automatically.");
assert.ok(renderer.includes('processOpen ? <div') && renderer.includes('data-testid="structured-process-content"'), "Collapsed process details must not mount their evidence body.");
assert.ok(renderer.includes("CompactProgressSection") && renderer.includes("AggregatedActivityDetails"), "Progress and operations must use compact grouped presentation.");
assert.ok(renderer.includes("ReasoningDisclosure") && renderer.includes('className="structured-analysis-disclosure"') && renderer.includes("parts.map(renderPart)"), "Reasoning must be summarized by default and remain expandable without evidence loss.");
assert.ok(projection.includes('segment.kind === "summary"') && projection.includes('...(summary ? { summary } : {})'), "OAEP reasoning summary segments must project into the concise presentation field.");
assert.ok(renderer.includes("BoundedProcessSection") && renderer.includes("ProcessWindowNavigation") && renderer.includes("groups.slice(window.start, window.end)"), "Large evidence collections must use bounded, navigable windows.");
assert.ok(renderer.includes('<summary className="structured-run-status"') && renderer.includes('className="structured-run-actions"'), "Process disclosure must share the run status row.");
assert.ok(renderer.includes('className="structured-important-notices"') && renderer.includes('className="structured-interaction-layer"'), "Warnings, failures and pending user actions must remain immediately visible.");
assert.ok(renderer.includes('className="structured-result-layer"') && renderer.includes('"回答"'), "The answer must remain outside process details.");
assert.equal(renderer.includes("执行记录已保存"), false, "Repeated execution-record boilerplate must not appear per operation.");
assert.equal(renderer.includes("StructuredActivitySummary"), false, "Elapsed time and current activity must not be duplicated in a second footer.");
assert.ok(renderer.includes('className="structured-process-footer"') && renderer.includes("查看完整运行"), "The process layer must expose one stable full-run evidence entry.");
assert.ok(renderer.includes('className="structured-source-list"') && renderer.includes("<summary>"), "Public sources must be collapsed into one expandable list.");
assert.ok(renderer.includes("onOpenCitation(citation)") && renderer.includes("stripTrailingSourceList(part.markdown)"), "Inline citations must remain actionable while duplicate trailing source text stays compact.");
assert.ok(renderer.includes("respondedRequestIds") && renderer.includes("onRespondInteraction"), "Interaction parts must be actionable and idempotent.");
assert.ok(renderer.includes("data-artifact-id={part.artifactId}") && renderer.includes("data-status={part.status}"), "Artifact cards must expose stable identity and status.");
assert.ok(renderer.includes("formatRunDuration") && renderer.includes("startedAt"), "One status-row duration must remain available.");
assert.equal(renderer.includes('className="structured-run-stop"'), false, "The transcript must not duplicate the Composer stop action.");

assert.ok(workspace.includes('message.role === "assistant" && message.structuredTurn') && workspace.includes("<StructuredMessageParts"), "ChatWorkspace must prefer the V2 document.");
assert.ok(workspace.includes("onOpenDebug={onOpenDebug ? () => onOpenDebug(message.runtimeRunId) : undefined}"), "Full technical evidence must route to the selected Runtime Run.");
assert.ok(workspace.includes('messages.some((message) => message.streaming)'), "Elapsed duration must refresh for the streaming turn.");
assert.ok(adapter.includes("desktopApi.cancelChatTurn") && adapter.includes('event.type === "aborted" ? "cancelled" : "completed"'), "Cancellation must settle structured streaming state.");
assert.ok(workspace.includes("!message.structuredTurn && message.reasoningContent") && workspace.includes("!message.structuredTurn && message.inputRequest"), "Legacy content must remain fallback-only.");
assert.ok(workspace.includes("onOpenWorkspaceArtifact") && workspace.includes("isSafeWebUrl(part.url)"), "Artifact and source navigation must stay safe and contextual.");
assert.ok(app.includes('setActiveRightTab("files")') && app.includes('setActiveRightTab("browser")'), "Artifacts and citations must route to existing panels.");
assert.ok(files.includes("focusPath") && files.includes("findWorkspaceNodeByArtifactPath(nodes, focusPath)"), "Files panel must focus selected artifacts.");

for (const className of ["structured-message-parts", "structured-run-status", "structured-process", "structured-important-notices", "structured-interaction-layer", "structured-result-layer", "structured-progress-group", "structured-activity-group", "structured-analysis-disclosure", "structured-source-list"]) {
  assert.ok(styles.includes(`.${className}`), `Missing ${className} styles.`);
}

console.log("Structured message renderer verification passed (compact default, grouped process, expandable evidence, visible warnings/actions)." );
