import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const conversation = readFileSync(join(root, "../shared/api/structuredConversation.ts"), "utf8");
const renderer = readFileSync(join(root, "../shared/renderer/src/components/StructuredMessageParts.tsx"), "utf8");
const chat = readFileSync(join(root, "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const app = readFileSync(join(root, "../shared/renderer/src/App.tsx"), "utf8");
const files = readFileSync(join(root, "../shared/renderer/src/components/files/FilesContextPanel.tsx"), "utf8");
const tuiTypes = readFileSync(join(root, "../../ui-tui/src/app/types.ts"), "utf8");
const tuiEvents = readFileSync(join(root, "../../ui-tui/src/app/createGatewayEventHandler.ts"), "utf8");

assert.ok(conversation.includes("previewable?: boolean") && conversation.includes("downloadable?: boolean"), "Conversation Artifact capabilities are missing.");
assert.ok(renderer.includes("formatArtifactSize") && renderer.includes("在文件中显示"), "Desktop Artifact card lacks size/action presentation.");
assert.ok(renderer.includes("onDownloadArtifact") && chat.includes("desktopApi.saveWorkspaceFileAs"), "Desktop Artifact card lacks an integrity-checked download/save-as action.");
assert.ok(app.includes("setFilesPanelFocusPath(path)") && app.includes('setActiveRightTab("files")'), "Artifact click does not route to Files.");
assert.ok(files.includes("findWorkspaceNodeByArtifactPath") && files.includes("normalizeWorkspaceArtifactPath"), "Files panel cannot correlate Runtime relative Artifact paths.");
assert.ok(files.includes("focusRefreshPathRef") && files.includes("void refresh()"), "Files panel does not refresh for a newly delivered Artifact.");
assert.ok(files.includes('data-testid="artifact-unavailable"') && files.includes("已移动、删除或暂时不可用"), "Files panel lacks a recoverable unavailable state for stale Artifact cards.");
assert.ok(tuiTypes.includes("ArtifactContentPart") && tuiEvents.includes("case 'artifact.created'"), "TUI does not consume the shared Artifact event.");

console.log("Workspace Artifact linkage P1 Desktop/TUI contract verification passed.");
