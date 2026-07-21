import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const service = read("../../../cores/python/packages/drsai/src/drsai/backend/git_worktree_service.py");
const gateway = read("../../../cores/python/packages/drsai/src/drsai/backend/gateway.py");
const facade = read("src/main/forkWorktrees.ts");
const threads = read("src/main/threads.ts");
const shell = read("src/renderer/src/components/WorkspaceShell.tsx");
const app = read("src/renderer/src/App.tsx");

for (const marker of ["def adopt(", "legacy_worktree_missing", "legacy_worktree_branch_mismatch"]) assert(service.includes(marker), `Runtime adoption lacks ${marker}`);
assert(gateway.includes("runtime_worktree_adopt"), "Gateway adoption endpoint is missing");
assert(facade.includes("migrateLegacyForks"), "Desktop first-read migration is missing");
assert(facade.includes("getWorktreeMigrationDiagnostics"), "Migration diagnostics are missing");
assert(threads.includes("execution: request.execution ?? existing?.execution"), "Backend updates may lose execution identity");
assert(shell.includes("onCreateWorktreeSession"), "Worktree session selector is missing");
assert(shell.includes("Legacy Fork migration pending"), "Migration failure is not visible");
assert(app.includes("effectiveRuntimeWorkspaceId"), "Selected Worktree Workspace is not used for execution");
assert(app.includes("activeThread?.execution?.workspaceId"), "Thread execution binding is not authoritative");
console.log("Legacy Worktree migration and execution selector verification passed.");

function assert(value, message) { if (!value) throw new Error(message); }
