import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const shared = join(root, "..", "shared");
const read = (path) => readFileSync(path, "utf8");
const api = read(join(shared, "api", "feedback.ts"));
const desktopApi = read(join(shared, "api", "desktopApi.ts"));
const service = read(join(shared, "main", "feedback.ts"));
const crash = read(join(shared, "main", "crashFeedback.ts"));
const preload = read(join(shared, "main", "preload.ts"));
const dialog = read(join(shared, "renderer", "src", "components", "FeedbackDialog.tsx"));
const shell = read(join(shared, "renderer", "src", "components", "WorkspaceShell.tsx"));
const chat = read(join(shared, "renderer", "src", "components", "ChatWorkspace.tsx"));
const app = read(join(shared, "renderer", "src", "App.tsx"));
const main = read(join(root, "src", "main", "index.ts"));

for (const policy of ["OPENDRSAI_FEEDBACK_DISABLED", "OPENDRSAI_FEEDBACK_ALLOW_SCREENSHOT", "OPENDRSAI_FEEDBACK_ALLOW_DIAGNOSTICS", "OPENDRSAI_FEEDBACK_SERVICE_URL", "OPENDRSAI_FEEDBACK_INTAKE_TOKEN"]) {
  assert.ok(service.includes(policy), `Feedback service missing policy/config ${policy}`);
}
assert.ok(["feedback_entry_exposed", "feedback_opened", "feedback_submitted", "feedback_submit_failed", "feedback_queued"].every((name) => service.includes(name)), "Feedback telemetry lifecycle is incomplete");
assert.ok(service.includes("generatedBreadcrumbs") && service.includes("MAX_BREADCRUMBS"), "Feedback breadcrumb buffer is missing");
assert.ok(crash.includes("ACTIONABLE_CRASH_REASONS") && crash.includes("MAX_INCIDENT_AGE_MS"), "Crash recovery must reject normal exits and stale incidents");
assert.ok(app.includes("if (sessionRestoring || !user) return;"), "Crash recovery must not appear during first-login/session restoration");

for (const contract of ["FeedbackCategory", "FeedbackSource", "FeedbackContext", "FeedbackConsent", "FeedbackPackagePreview", "FeedbackSubmitResult", "PendingFeedbackItem", "PendingCrashFeedback"]) assert.ok(api.includes(contract), `Missing shared contract ${contract}`);
for (const method of ["previewFeedback", "submitFeedback", "listPendingFeedback", "retryPendingFeedback", "deletePendingFeedback", "getPendingCrashFeedback", "clearPendingCrashFeedback", "captureFeedbackScreenshot", "listFeedbackAdmin", "updateFeedbackAdmin", "deleteFeedbackAdmin"]) {
  assert.ok(desktopApi.includes(method), `DesktopApi missing ${method}`);
  assert.ok(preload.includes(method), `Preload missing ${method}`);
}
for (const safety of ["aes-256-gcm", "MAX_PENDING", "Idempotency-Key", "sensitive_matches_removed", "desktopDiagnostics.serializeExport", "startGateway"]) assert.ok(service.includes(safety), `Feedback service missing ${safety}`);
for (const safety of ["uploadToServer: false", "recordCrashIncident", "getPendingCrashFeedback", "clearPendingCrashFeedback", "latestCrashDumpBase64"]) assert.ok(crash.includes(safety), `Crash recovery missing ${safety}`);
for (const interaction of ["反馈与建议", "附带脱敏诊断信息", "附带当前窗口截图", "拖拽遮挡敏感区域", "查看将发送的信息", "反馈编号", "已安全保存在本机", "sensitive_matches_removed"]) assert.ok(dialog.includes(interaction), `Feedback dialog missing ${interaction}`);
assert.ok(shell.includes("user-menu-feedback"), "User menu feedback entry is missing");
assert.ok(chat.includes("message-feedback-"), "Contextual failed-message feedback entry is missing");
for (const ipc of ["feedback-preview", "feedback-submit", "feedback-pending-list", "feedback-pending-retry", "feedback-pending-delete", "feedback-crash-pending", "feedback-crash-clear", "feedback-screenshot-capture", "feedback-admin-list", "feedback-admin-update", "feedback-admin-delete"]) assert.ok(main.includes(ipc), `Windows main missing ${ipc}`);
assert.ok(main.includes("initializeLocalCrashReporter"));
assert.ok(main.includes("render-process-gone"));
console.log("Feedback P1 Desktop contract verification passed (shared protocol, safe queue, global/context entry, privacy preview, crash recovery, IPC)." );
