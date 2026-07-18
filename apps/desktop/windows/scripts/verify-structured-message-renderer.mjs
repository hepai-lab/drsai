import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const renderer = readFileSync(join(root, "src/renderer/src/components/StructuredMessageParts.tsx"), "utf8");
const workspace = readFileSync(join(root, "src/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const app = readFileSync(join(root, "src/renderer/src/App.tsx"), "utf8");
const files = readFileSync(join(root, "src/renderer/src/components/files/FilesContextPanel.tsx"), "utf8");
const styles = readFileSync(join(root, "src/renderer/src/styles.css"), "utf8");

for (const kind of ["markdown", "reasoning", "progress", "artifact", "citation", "interaction", "subtask", "notice"]) {
  const present = kind === "notice"
    ? renderer.includes("return <NoticeItem")
    : renderer.includes(`part.kind === "${kind}"`) || renderer.includes(`kind: "${kind}"`);
  assert.ok(present, `Missing ${kind} renderer.`);
}
assert.equal(renderer.includes('part.kind === "tool"'), false, "Tool activity must not render in the conversation document.");
assert.ok(
  renderer.includes('part.kind === "progress"')
    && renderer.includes('part.status === "running"')
    && renderer.includes('part.status === "pending"')
    && renderer.includes('part.status === "error"'),
  "Completed progress must be hidden from the transcript.",
);
assert.ok(
  renderer.includes('part.kind === "interaction"')
    && renderer.includes('return part.status === "running" || part.status === "pending"'),
  "Resolved interactions must leave the transcript.",
);
assert.ok(renderer.includes("part.segments.map") && renderer.includes("structured-reasoning"), "Reasoning segments must share one disclosure.");
assert.ok(renderer.includes("respondedRequestIds") && renderer.includes("onRespondInteraction"), "Interaction parts must be actionable and idempotent.");
assert.ok(renderer.includes("onOpenArtifact") && renderer.includes("onOpenCitation"), "Artifacts and citations must route to contextual panels.");
assert.ok(renderer.includes("part.citationIds.map") && renderer.includes("focusPart(citation.id)"), "Markdown citations must locate stable citation cards.");
assert.ok(renderer.includes("part.markdownPartId") && renderer.includes("structured-citation-back"), "Citation cards must navigate back to the related markdown part.");
assert.ok(renderer.includes("data-artifact-id={part.artifactId}") && renderer.includes("data-status={part.status}"), "Artifact cards must expose stable identity and status.");

assert.ok(workspace.includes('message.role === "assistant" && message.structuredTurn'), "ChatWorkspace must prefer the V2 document.");
assert.ok(workspace.includes("<StructuredMessageParts"), "ChatWorkspace must render V2 parts directly.");
assert.ok(workspace.includes("!message.structuredTurn && message.reasoningContent"), "Legacy reasoning must only be a fallback.");
assert.ok(workspace.includes("!message.structuredTurn && message.inputRequest"), "Legacy interaction must only be a fallback.");
assert.ok(workspace.includes("onOpenWorkspaceArtifact"), "ChatWorkspace must expose the existing files-panel route.");
assert.ok(workspace.includes("isSafeWebUrl(part.url)"), "Structured web targets must use an HTTP(S) allowlist.");

assert.ok(app.includes('setActiveRightTab("files")') && app.includes("setFilesPanelFocusPath(path)"), "Artifact clicks must open the existing Files panel.");
assert.ok(app.includes('setActiveRightTab("browser")'), "Citation URLs must use the existing Browser panel.");
assert.ok(files.includes("focusPath") && files.includes("findNodeByPath(nodes, focusPath)"), "Files panel must focus the selected artifact.");

for (const className of ["structured-message-parts", "structured-progress", "structured-artifact", "structured-citation", "structured-notice"]) {
  assert.ok(styles.includes(`.${className}`), `Missing ${className} styles.`);
}
assert.ok(styles.includes(".structured-progress,") && !styles.includes(".structured-progress {\n  border:"), "Progress must remain a quiet text-level status.");

console.log("Structured message renderer verification passed (8 part kinds, 4 panel/visibility rules)." );
