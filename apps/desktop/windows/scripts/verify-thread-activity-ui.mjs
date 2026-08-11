import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("../shared/renderer/src/App.tsx");
const shell = read("../shared/renderer/src/components/WorkspaceShell.tsx");
const bubble = read("../shared/renderer/src/components/ThreadActivityBubble.tsx");
const css = read("../shared/renderer/src/styles.css");
const threads = read("../shared/main/threads.ts");
const backgroundTasks = read("src/main/backgroundTasks.ts");

assert(app.includes("indexBackgroundTasksByThread(threads, threadBackgroundTasks)"));
assert(app.includes("deriveThreadActivity({"));
assert(app.includes("document.visibilityState === \"visible\" ? 1_000 : 15_000"));
assert(app.includes("haveSameThreadTaskActivity(current, next)"));
assert(shell.includes("activity: ThreadActivityState"));
assert(shell.includes('thread.activity.kind === "idle"'));
assert(shell.includes("<ThreadActivityBubble"));
assert(shell.includes('className="thread-item-status"'));
assert(bubble.includes('role="status"'));
assert(bubble.includes("正在运行") && bubble.includes("等待批准") && bubble.includes("等待回复"));
assert(bubble.split("<i />").length - 1 === 3);
assert(css.includes(".thread-item .thread-item-status"));
assert(css.includes("width: 44px") && css.includes("min-width: 44px"));
assert(css.includes("@keyframes thread-activity-orbit"));
assert(css.includes("@media (prefers-reduced-motion: reduce)"));
assert(css.includes(".thread-activity-bubble.attention i:nth-child(3)"));
assert(threads.includes("sanitizeSnapshotInputRequest"));
assert(threads.includes("...(inputRequest ? { inputRequest } : {})"));
assert(backgroundTasks.includes("request.threadId"));
assert(backgroundTasks.includes("threadId: request.threadId"));

process.stdout.write("Thread activity UI verification passed (20 checks).\n");
