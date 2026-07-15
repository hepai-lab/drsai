import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const checks = [];
function check(name, condition) {
  if (!condition) throw new Error(`Completion notification contract failed: ${name}`);
  checks.push(name);
}

const packageJson = read("package.json");
const api = read("src/shared/desktopApi.ts");
const service = read("src/main/completionNotifications.ts");
const main = read("src/main/index.ts");
const preload = read("src/preload/index.ts");
const app = read("src/renderer/src/App.tsx");
const smoke = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-e2e-agent-run.mjs");

check("typed preference and click target", api.includes("CompletionNotificationPreference") && api.includes("CompletionNotificationClickEvent"));
check("typed renderer bridge", api.includes("setCompletionNotificationPreference(") && api.includes("onCompletionNotificationClick("));
check("native Electron notification", service.includes('import { Notification } from "electron"') && service.includes("new Notification({ title, body"));
check("Windows support respected", service.includes("Notification.isSupported()"));
check("user preference defaults off", service.includes('enabled: false, language: "zh"'));
check("preference persisted atomically", service.includes("completion-notifications.json") && service.includes("randomUUID()}.tmp") && service.includes("rename(temporaryPath, SETTINGS_FILE)"));
check("completion deduplicated", service.includes("shownKeys.has(key)") && service.includes("shownKeys.add(key)"));
check("notification text bounded", service.includes("slice(0, 120)"));
check("credential redaction", service.includes("Bearer") && service.includes("sk-") && service.includes("api[_-]?key") && service.includes("password"));
check("email redaction", service.includes("[已隐藏邮箱]"));
check("click focuses and publishes target", service.includes("handlers.focusApp()") && service.includes("handlers.publishClick"));
check("Windows AppUserModelId configured", main.includes('app.setAppUserModelId("com.hepai.opendrsai.windows")'));
check("Agent completions notify", main.includes('kind: "agent_run"') && main.includes("notifyBackgroundTaskCompleted(task"));
check("presentation completions notify", main.includes('kind: "presentation_generation"') && main.includes('progress.phase === "completed"'));
check("preload preference IPC", preload.includes("desktop:completion-notification-preference-set"));
check("preload click event", preload.includes("desktop:completion-notification-click"));
check("settings UI explains background notifications", app.includes("后台任务完成时发送 Windows 通知") && app.includes("onCompletionNotificationClick"));
check("renderer routes notification target", app.includes("setActiveThreadId(event.target.threadId)") && app.includes("setActiveWorkspaceId(getWorkspaceId(event.target.workspacePath))"));
check("packaged foreground coverage", smoke.includes("windowsNotificationShownForeground"));
check("packaged minimized and hidden coverage", smoke.includes("windowMinimizedDuringBackgroundWork") && smoke.includes("backgroundCompletedWhileWindowHidden"));
check("packaged click and dedup coverage", smoke.includes("notificationClickTargetsCorrectTask") && smoke.includes("duplicateCompletionNotificationSuppressed"));
check("packaged disabled preference coverage", smoke.includes("disabledCompletionNotificationPreferenceRespected"));
check("three packaged commands registered", packageJson.includes("verify:e2e-agent-run-minimized-notification") && packageJson.includes("verify:e2e-agent-run-background-close"));
check("runner recognizes minimized scenario", runner.includes('"minimized-notification"') && runner.includes("E2E Agent minimized-notification check failed"));

console.log(`Completion notification verification passed (${checks.length} checks).`);
