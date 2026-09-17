import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const augmentation = readFileSync(resolve(root, "../shared/api/desktopApi.orca.d.ts"), "utf8");
const threads = readFileSync(resolve(root, "../shared/main/threads.ts"), "utf8");
for (const field of ["sourceWorkspaceId", "workspaceId", "worktreeId", "canonicalPath"]) {
  assert(augmentation.includes(field), `execution binding lacks ${field}`);
}
assert(threads.includes("sanitizeExecutionBinding"), "Thread execution identity is not validated");
assert(threads.includes("execution: request.execution"), "Thread creation does not persist execution identity");
assert(threads.includes("execution: request.execution ?? existing?.execution"), "Thread update may discard execution identity during Backend changes");
assert(!/execution\s*:\s*\{[^}]*backend/i.test(threads), "Agent Backend leaked into Workspace execution identity");
console.log("Thread Worktree execution binding verification passed.");

function assert(value, message) { if (!value) throw new Error(message); }
