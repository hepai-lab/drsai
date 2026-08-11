import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "..");
const runtimeClient = readFileSync(resolve(desktopRoot, "../shared/main/runtimeClient.ts"), "utf8");
const worktrees = readFileSync(resolve(desktopRoot, "../shared/main/worktrees.ts"), "utf8");
const desktopMain = readFileSync(resolve(desktopRoot, "src/main/index.ts"), "utf8");

assert.match(runtimeClient, /listWorktrees\(workspaceId: string, includeRemoved\?: boolean, auth\?: RuntimeExecutionAuth\)/);
assert.match(runtimeClient, /listWorkspaceEvents\(workspaceId: string, afterSequence\?: number, auth\?: RuntimeExecutionAuth\)/);
assert.match(runtimeClient, /worktrees\?include_removed=.*\n\s*\{ headers: this\.runtimeEvidenceHeaders\(auth\) \}/s);
assert.match(runtimeClient, /events\?after_sequence=.*\n\s*\{ headers: this\.runtimeEvidenceHeaders\(auth\) \}/s);
assert.match(worktrees, /listWorktrees\([\s\S]*await requireAuthContext\(\)/);
assert.match(worktrees, /listWorkspaceEvents\([\s\S]*await requireAuthContext\(\)/);
assert.match(runtimeClient, /isolated_worktree_id: request\.isolatedWorktreeId, location: this\.location/);
assert.match(desktopMain, /worktree: capabilities\.capabilities\.includes\("worktree"\)/);
assert.match(desktopMain, /runtime_location: resolved\.client\.location/);
console.log("Phase 2 Runtime Worktree authentication propagation contract passed.\n");
