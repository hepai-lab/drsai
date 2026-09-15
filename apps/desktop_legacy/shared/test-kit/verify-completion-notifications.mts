import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

const root = await mkdtemp(join(tmpdir(), "drsai-completion-notifications-"));
process.env.DRSAI_HOME = root;
const service = await import("../main/completionNotifications");
class NotificationHandle extends EventEmitter {
  shown = 0;
  show(): void { this.shown += 1; }
  override once(event: "click" | "close", listener: () => void): this { return super.once(event, listener); }
}
const created: Array<{ input: { title: string; body: string }; handle: NotificationHandle }> = [];
const clicks: unknown[] = [];
let focused = 0;
service.configureCompletionNotifications({
  notifications: { supported: () => true, create: (input) => { const handle = new NotificationHandle(); created.push({ input, handle }); return handle; } },
  focusApp: () => { focused += 1; },
  publishClick: (event) => clicks.push(event),
  getWindowVisibility: () => "hidden",
});

assert.deepEqual(await service.restoreCompletionNotificationPreference(), { enabled: false, language: "zh" });
await service.setCompletionNotificationPreference({ enabled: true, language: "zh" });
const persisted = JSON.parse(await readFile(join(root, "desktop", "completion-notifications.json"), "utf8"));
assert.deepEqual(persisted, { enabled: true, language: "zh" });
if (process.platform !== "win32") assert.equal((await stat(join(root, "desktop", "completion-notifications.json"))).mode & 0o777, 0o600);

const task = {
  id: "background-task:agent_run:00000000-0000-4000-8000-000000000001", kind: "agent_run", source: "agent",
  title: "Report token=secret-value user@example.com 13812345678", status: "completed", createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(), message: "done", verification: "passed", attempt: 1, maxAttempts: 3,
} as const;
const target = { kind: "agent_run", targetId: "run-1", workspacePath: "/workspace" } as const;
assert.equal(service.notifyBackgroundTaskCompleted(task, target), true);
assert.equal(service.notifyBackgroundTaskCompleted(task, target), false, "duplicate completion must be suppressed");
assert.equal(created.length, 1);
assert.equal(created[0].handle.shown, 1);
assert.doesNotMatch(created[0].input.body, /secret-value|user@example\.com|13812345678/);
created[0].handle.emit("click");
assert.equal(focused, 1);
assert.equal(clicks.length, 1);
assert.equal(service.getCompletionNotificationDiagnostics()[0].visibility, "hidden");

await service.setCompletionNotificationPreference({ enabled: false, language: "en" });
assert.equal(service.notifyBackgroundTaskCompleted({ ...task, id: task.id.replace(/1$/, "2") }, { ...target, targetId: "run-2" }), false);
console.log("Completion notification verification passed.");
