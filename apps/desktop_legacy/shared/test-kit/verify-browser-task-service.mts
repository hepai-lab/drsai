import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserTaskService } from "../main/browser/browserTaskService";
import { BrowserUseWorkerClient } from "../main/browser/workerClient";
import type { BrowserUseWorkerCommand } from "../main/browser/protocol";
import type { BrowserTaskEvent } from "../api/browser/types";

const traceRoot = await mkdtemp(join(tmpdir(), "drsai-browser-traces-"));
const worker = new BrowserUseWorkerClient();
const commands: BrowserUseWorkerCommand[] = [];
let starts = 0;
Object.assign(worker, {
  start: () => { starts += 1; },
  send: (command: BrowserUseWorkerCommand) => commands.push(command),
  stop: () => undefined,
});
const events: BrowserTaskEvent[] = [];
const service = new BrowserTaskService({
  worker,
  workerOptions: () => ({ pythonCommand: "python3", workerPath: "/unused", dataRoot: traceRoot }),
  traceRoot,
  publish: (event) => events.push(event),
});

assert.equal(service.checkUrl("http://example.com").allowed, false);
assert.equal(service.checkUrl("https://user:pass@example.com").allowed, false);
assert.equal(service.checkUrl("http://127.0.0.1:3000").allowed, true);
assert.equal(service.checkUrl("https://example.com/path").allowed, true);
assert.equal(service.requestAction({ action: "click", selector: "#submit" }).ok, false);
assert.equal(service.requestAction({ action: "click", selector: "#submit", approved: true }).ok, true);
await assert.rejects(() => service.start({ instruction: "x", url: "http://example.com" }), /HTTPS/);

const started = await service.start({ taskId: "task-1", instruction: "Inspect the page", url: "https://example.com" });
assert.deepEqual(started, { taskId: "task-1" });
assert.equal(starts, 1);
assert.equal(commands[0].type, "task.start");
assert.equal(service.stop({ taskId: "unknown" }), false);
assert.equal(service.stop({ taskId: "task-1" }), true);

const proposal: BrowserTaskEvent = { type: "action.proposed", taskId: "task-1", actionId: "action-1", action: "click", target: "#submit", requiresApproval: true, timestamp: new Date().toISOString() };
worker.emit("event", proposal);
assert.equal(service.pendingApprovals().length, 1);
assert.equal(service.approve({ taskId: "other", actionId: "action-1", approved: true }), false);
assert.equal(service.approve({ taskId: "task-1", actionId: "action-1", approved: false }), true);
assert.equal(service.pendingApprovals().length, 0);
assert.deepEqual(commands.at(-1), { type: "action.approve", taskId: "task-1", actionId: "action-1", approved: false });

worker.emit("event", { type: "task.completed", taskId: "task-1", result: "done", timestamp: new Date().toISOString() } satisfies BrowserTaskEvent);
assert.equal(service.stop({ taskId: "task-1" }), false);
await new Promise((resolve) => setTimeout(resolve, 20));
const trace = JSON.parse(await readFile(join(traceRoot, "task-1.json"), "utf8"));
assert.equal(trace.result, "done");
assert.equal(trace.events.length, 2);
assert.equal(events.length, 2);
await assert.rejects(() => service.start({ instruction: "ok", taskId: "../escape" }), /id/);
console.log("Browser URL policy, action approval, task lifecycle, approval ownership, cancellation and trace tests passed.");
