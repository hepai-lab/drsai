export type WorktreeVisualState =
  | "creating"
  | "active"
  | "dirty"
  | "conflict"
  | "merged"
  | "archived"
  | "removed";

export interface WorktreePresentationInput {
  status: "creating" | "active" | "review" | "merge_pending" | "merged" | "archived" | "removing" | "removed";
  dirty?: boolean;
}

export interface WorktreeReviewInput extends WorktreePresentationInput {
  branch: string;
  baseCommit: string;
  headCommit?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

export interface WorktreeReviewThreadInput {
  queueStatus?: "queued" | "waiting_approval" | "ready" | "running" | "blocked" | "completed";
  queueMessage?: string;
  lifecycleMessage?: string;
}

export interface WorktreeReviewModel {
  branch: string;
  commitRange: string;
  changed: boolean;
  conflict: { active: boolean; detail?: string };
  tests: { status: "not_reported" | "running" | "blocked" | "completed"; detail: string };
  readiness: { status: "ready" | "attention" | "blocked"; reasons: string[] };
  diff: string;
  diffTruncated: boolean;
}

export function buildWorktreeReview(
  worktree: WorktreeReviewInput,
  thread: WorktreeReviewThreadInput | undefined,
  diff: { diff: string; truncated?: boolean } | undefined,
): WorktreeReviewModel {
  const head = worktree.headCommit || worktree.baseCommit;
  const changed = head !== worktree.baseCommit || Boolean(diff?.diff.trim());
  const conflictActive = worktree.status === "merge_pending" || Boolean(worktree.lastErrorCode?.toLowerCase().includes("conflict"));
  const testStatus = thread?.queueStatus === "running"
    ? "running"
    : thread?.queueStatus === "blocked"
      ? "blocked"
      : thread?.queueStatus === "completed"
        ? "completed"
        : "not_reported";
  const reasons: string[] = [];
  if (conflictActive) reasons.push(worktree.lastErrorMessage || thread?.lifecycleMessage || "Merge conflicts require resolution.");
  if (worktree.dirty) reasons.push("The Worktree has uncommitted changes.");
  if (!changed) reasons.push("No commit or diff exists beyond the base revision.");
  if (testStatus === "blocked") reasons.push(thread?.queueMessage || "The reported test workflow is blocked.");
  if (testStatus === "running") reasons.push("The reported test workflow is still running.");
  if (testStatus === "not_reported") reasons.push("No authoritative test result has been reported.");
  const blocked = conflictActive || Boolean(worktree.dirty) || testStatus === "blocked";
  return {
    branch: worktree.branch,
    commitRange: `${worktree.baseCommit}..${head}`,
    changed,
    conflict: { active: conflictActive, detail: conflictActive ? (worktree.lastErrorMessage || thread?.lifecycleMessage) : undefined },
    tests: {
      status: testStatus,
      detail: thread?.queueMessage || (testStatus === "not_reported" ? "No Runtime test result reported" : `Runtime workflow: ${testStatus}`),
    },
    readiness: { status: blocked ? "blocked" : reasons.length ? "attention" : "ready", reasons },
    diff: diff?.diff || "",
    diffTruncated: diff?.truncated === true,
  };
}

export function getWorktreeVisualState(worktree: WorktreePresentationInput): WorktreeVisualState {
  if (worktree.status === "merge_pending") return "conflict";
  if (worktree.status === "merged") return "merged";
  if (worktree.status === "archived") return "archived";
  if (worktree.status === "removed" || worktree.status === "removing") return "removed";
  if (worktree.status === "creating") return "creating";
  if (worktree.dirty) return "dirty";
  return "active";
}

export function getWorktreeListMode(count: number, loading: boolean, error: string | null): "loading" | "offline" | "empty" | "ready" {
  if (loading) return "loading";
  if (error) return "offline";
  return count === 0 ? "empty" : "ready";
}

export function getWorktreeActions(worktree: WorktreePresentationInput, linkedThread: boolean): { canMerge: boolean; canRemove: boolean } {
  if (!linkedThread) return { canMerge: false, canRemove: false };
  return {
    canMerge: ["active", "review", "merge_pending"].includes(worktree.status),
    canRemove: ["active", "review", "merge_pending", "merged", "archived"].includes(worktree.status),
  };
}
