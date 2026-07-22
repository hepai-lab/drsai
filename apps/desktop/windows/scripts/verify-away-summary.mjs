import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("../shared/renderer/src/App.tsx");
const styles = read("../shared/renderer/src/styles.css");
const e2e = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-e2e-agent-run.mjs");

const checks = [
  ["visibility changes establish a persisted away boundary", app.includes("AWAY_STARTED_AT_STORAGE_KEY") && app.includes('document.visibilityState === "hidden"')],
  ["return reads the persisted background queue", app.includes("listBackgroundTasks") && app.includes("updatedMs >= startedMs")],
  ["summary separates completed failed and pending events", app.includes('id: "completed"') && app.includes('id: "failed"') && app.includes('id: "pending"')],
  ["pending decisions take precedence over terminal buckets", app.includes("pendingIds") && app.includes('task.status === "waiting_approval"')],
  ["return summary is a priority live region", app.includes('data-testid="away-summary"') && app.includes('aria-live="assertive"')],
  ["all three regions remain structurally visible", app.includes('data-testid={`away-summary-${group.id}`}') && app.includes('id: "completed"') && app.includes('id: "failed"') && app.includes('id: "pending"')],
  ["summary avoids requiring timeline traversal", app.includes("无需翻找完整时间线")],
  ["summary redacts secrets and email addresses", app.includes("redactAwaySummaryText") && app.includes("[已隐藏邮箱]") && e2e.includes("awaySummarySensitiveTextRedacted")],
  ["pending events expose a continue action", app.includes('data-testid={group.id === "pending" ? "away-summary-continue"')],
  ["approval-backed decisions route directly to Approval Center", app.includes("task.approvalId") && app.includes("MENU_IDS.approvalCenter")],
  ["agent and presentation outcomes have direct destinations", app.includes('task.kind === "agent_run"') && app.includes('task.kind === "presentation_generation"')],
  ["summary has bounded responsive visual treatment", styles.includes(".away-summary-panel") && styles.includes(".away-summary-groups") && styles.includes("max-height")],
  ["packaged test hides the native window", e2e.includes("nativeWindowCloseIntercepted") && e2e.includes("windowHiddenDuringBackgroundWork")],
  ["packaged test creates completion failure and pending events while hidden", e2e.includes("awayFailureSeeded") && e2e.includes("awayPendingDecisionSeeded") && e2e.includes("backgroundCompletedWhileWindowHidden")],
  ["packaged test asserts all summary regions", e2e.includes("awaySummaryHasThreeStructuredRegions") && e2e.includes("awaySummaryContainsCompletedTask") && e2e.includes("awaySummaryContainsFailedTask") && e2e.includes("awaySummaryContainsPendingDecision")],
  ["packaged test clicks continue and locates the exact approval", e2e.includes("awaySummaryContinueLocatedPendingEvent") && e2e.includes("确认是否采用新的带宽规划方案")],
  ["packaged runner makes away-summary assertions release gates", runner.includes("awaySummaryPrioritizedOnReturn") && runner.includes("awaySummaryContinueLocatedPendingEvent")],
];

const failures = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(`Away summary verification passed (${checks.length} checks).`);
