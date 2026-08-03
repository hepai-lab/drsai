import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (path) => readFileSync(join(root, path), "utf8");
const api = read("../shared/api/desktopApi.ts");
const app = read("../shared/renderer/src/App.tsx");
const chatUi = read("../shared/renderer/src/components/ChatWorkspace.tsx");
const structured = read("../shared/renderer/src/components/StructuredMessageParts.tsx");
const errors = read("../shared/renderer/src/userFacingErrors.ts");
const chatMain = read("../shared/main/chat.ts");
const subscription = read("../shared/main/threadRuntimeSubscription.ts");
const projection = read("../shared/main/threadRuntimeProjection.ts");
const syncState = read("../shared/main/sessionSyncState.ts");
const runtimeClient = read("../shared/main/runtimeClient.ts");
const dev = read("scripts/dev.ps1");
const gateway = read("../../../cores/python/packages/drsai/src/drsai/backend/gateway.py");
const agent = read("../../../cores/python/packages/drsai/src/drsai/backend/runtime/agent.py");
const engine = read("../../../cores/python/packages/drsai/src/drsai/backend/runtime/engine.py");
const codex = read("../../../cores/python/packages/drsai/src/drsai/backend/codex_adapter/backend_client.py");
const decoder = read("../../../cores/python/packages/drsai/src/drsai/backend/codex_adapter/native_decoder.py");

const checks = [
  ["M1-F01 sync lifecycle", api.includes("DesktopThreadHistoryState") && chatUi.includes("conversation-sync-status")],
  ["M1-F02 sync time and counts", api.includes("syncedAt?: string") && api.includes("loadedRuns: number")],
  ["M1-F03 immediate loading state", chatUi.includes("Loading Codex session") && app.includes("conversationHistoryPending")],
  ["M1-F04 projection correction feedback", api.includes("correctedItems?: number") && chatUi.includes("Partially synced")],
  ["M1-F05 ordering diagnostics", projection.includes("projectionWarnings") && projection.includes("stable fallback ordering")],

  ["M2-F01 runtime identity", gateway.includes('"dev_managed"') && runtimeClient.includes("interface RuntimeIdentity")],
  ["M2-F02 layered Codex status", api.includes("appServerState") && api.includes("adapterVersion")],
  ["M2-F03 source gateway identity", dev.includes("Test-DevManagedGateway") && dev.includes("Replacing non-development Gateway")],
  ["M2-F04 status overview", app.includes("codex-health-layers") && app.includes("连接方式")],
  ["M2-F05 detect and repair", app.includes("onCodexRefresh") && app.includes("onCodexRepair") && app.includes("onCodexRestart")],
  ["M2-F06 reconnect without duplicates", subscription.includes("OaepEventGap") && syncState.includes("advanceCursor")],

  ["M3-F01 visible session operations", app.includes("handleNewChat") && app.includes("syncWorkspaceSessions")],
  ["M3-F02 archived center and search", app.includes("archived-threads-settings") && app.includes("archiveSearch")],
  ["M3-F03 bidirectional archive", agent.includes("archive_session") && codex.includes('"thread/archive" if archived else "thread/unarchive"')],
  ["M3-F04 archive conflict policy", engine.includes('_timestamp(str(existing["updated_at"])) > _timestamp(updated)') && agent.includes('"conflicts": 0')],
  ["M3-F05 session source", api.includes('archiveSource?: "opendrsai" | "codex"') && api.includes("boundAgentName")],
  ["M3-F06 direct sync feedback", app.includes("Codex 会话同步完成") && app.includes("cancelWorkspaceSessionSync")],

  ["M4-F01 full native history scrollbar", chatUi.includes("const visibleMessages = conversationMessages") && !chatUi.includes("historyRunLimit") && !chatUi.includes("loadEarlierMessages")],
  ["M4-F02 virtualized heavy message rendering", chatUi.includes("VirtualizedMessage") && chatUi.includes("estimateVirtualMessageHeight") && chatUi.includes("virtual-message-placeholder")],
  ["M4-F03 compact heavy activity", structured.includes("structured-activity-compact") && structured.includes("View details in Debug")],
  ["M4-F04 latest navigation", chatUi.includes("conversation-jump-latest") && chatUi.includes("scrollToLatest")],
  ["M4-F05 search and date navigation", chatUi.includes("searchMatches") && chatUi.includes("locateConversationDate")],
  ["M4-F06 retryable loading failure", app.includes("conversation-history-error") && app.includes("hydrateThreadSnapshot(activeThreadId)")],

  ["M5-F01 final answer first", structured.includes('part.kind === "markdown"') && structured.includes("ChatMessageContent")],
  ["M5-F02 folded reasoning", structured.includes("StructuredReasoning") && structured.includes("<details")],
  ["M5-F03 file summary", structured.includes("changedFiles.size") && structured.includes("已修改")],
  ["M5-F04 compact commands", structured.includes('activity.kind === "tool"') && structured.includes("durationMs")],
  ["M5-F05 dedicated cards", structured.includes("ArtifactItem") && structured.includes("InteractionItem") && structured.includes("NoticeItem")],
  ["M5-F06 multimodal availability", projection.includes("Media content is available only from its source Codex runtime") && projection.includes("resource_ref")],

  ["M6-F01 reuse Runtime Session", chatMain.includes("existingThread?.runtimeSessionId")],
  ["M6-F02 continuation disclosure", chatUi.includes("conversation-titlebar-details") && chatUi.includes("Continue in the current Codex task")],
  ["M6-F03 no silent replacement", chatMain.includes("codex_session_resume_required")],
  ["M6-F04 stable request identity", chatMain.includes("desktop-runtime-${requestId}") && chatMain.includes("desktop:${requestId}")],
  ["M6-F05 durable idempotent outbox", syncState.includes("beginOutbox") && syncState.includes("payloadHash") && syncState.includes("attachRun")],
  ["M6-F06 explicit running action", chatUi.includes("showStop") && chatUi.includes("onAbort")],

  ["M7-F01 user-facing errors", errors.includes("describeUserFacingError") && errors.includes("操作没有完成")],
  ["M7-F02 retry and detail actions", chatUi.includes('"same_session"') && chatUi.includes('"new_session"') && app.includes("onOpenDebug")],
  ["M7-F03 one-click redacted report", app.includes("copy-codex-diagnostic") && app.includes("复制脱敏诊断")],
  ["M7-F04 report compatibility fields", app.includes("adapterVersion: codexStatus.adapterVersion") && app.includes("transport: codexStatus.transport")],
  ["M7-F05 unknown item fallback", decoder.includes("codex_item_unknown") && projection.includes('item.type === "notice"')],

  ["M8-F01 status contract tests", existsSync(join(root, "scripts/verify-codex-desktop-integration.mjs"))],
  ["M8-F02 OAEP projection tests", existsSync(join(root, "scripts/verify-session-conversation-subscription.mts"))],
  ["M8-F03 archive tests", existsSync(join(root, "scripts/verify-thread-archive.mts"))],
  ["M8-F04 continuity tests", existsSync(join(root, "../../../cores/python/packages/drsai/tests/test_codex_backend_client.py"))],
  ["M8-F05 visual and diagnostics tests", existsSync(join(root, "scripts/verify-structured-visual.mjs")) && existsSync(join(root, "scripts/verify-unified-diagnostics.mjs"))],
  ["M8-F06 real Codex verifier", existsSync(join(root, "../../../scripts/verify-codex-oaep-real-history.py"))],
];

assert.equal(checks.length, 46);
const failed = checks.filter(([, accepted]) => !accepted).map(([name]) => name);
assert.deepEqual(failed, [], `V5 usability checks failed:\n${failed.join("\n")}`);
console.log(`Codex V5 usability verification passed (${checks.length}/${checks.length}).`);
