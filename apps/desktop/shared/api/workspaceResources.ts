export type WorktreeId = string;
export type TerminalId = string;
export type TerminalLeaseId = string;
export type HostProfileId = string;
export type PortForwardId = string;

export type WorkspaceResourceLocation = "local" | "remote";
export type WorktreeStatus =
  | "creating"
  | "active"
  | "review"
  | "merge_pending"
  | "merged"
  | "archived"
  | "removing"
  | "removed";

export type TerminalStatus =
  | "starting"
  | "running"
  | "detached"
  | "reconnecting"
  | "exited"
  | "lost";

export interface WorktreeResource {
  worktreeId: WorktreeId;
  sourceWorkspaceId: string;
  workspaceId: string;
  repoRoot: string;
  canonicalPath: string;
  branch: string;
  baseCommit: string;
  status: WorktreeStatus;
  location: WorkspaceResourceLocation;
  createdAt: string;
  updatedAt: string;
}

export interface TerminalResource {
  terminalId: TerminalId;
  runtimeId: string;
  workspaceId: string;
  worktreeId?: WorktreeId;
  status: TerminalStatus;
  generation: number;
  lastSequence: number;
  createdAt: string;
  exitedAt?: string;
}

const WORKTREE_TRANSITIONS: Readonly<Record<WorktreeStatus, ReadonlySet<WorktreeStatus>>> = {
  creating: new Set(["active", "archived", "removing"]),
  active: new Set(["review", "merge_pending", "archived", "removing"]),
  review: new Set(["active", "merge_pending", "merged", "archived", "removing"]),
  merge_pending: new Set(["active", "review", "merged", "archived", "removing"]),
  merged: new Set(["removing"]),
  archived: new Set(["active", "removing"]),
  removing: new Set(["removed"]),
  removed: new Set(),
};

const TERMINAL_TRANSITIONS: Readonly<Record<TerminalStatus, ReadonlySet<TerminalStatus>>> = {
  starting: new Set(["running", "exited", "lost"]),
  running: new Set(["detached", "reconnecting", "exited", "lost"]),
  detached: new Set(["running", "reconnecting", "exited", "lost"]),
  reconnecting: new Set(["running", "detached", "exited", "lost"]),
  exited: new Set(),
  lost: new Set(),
};

const RESOURCE_ID_PATTERNS = {
  worktree: /^worktree-[A-Za-z0-9][A-Za-z0-9-]{0,127}$/,
  terminal: /^terminal-[A-Za-z0-9][A-Za-z0-9-]{0,127}$/,
  terminalLease: /^terminal-lease-[A-Za-z0-9][A-Za-z0-9-]{0,127}$/,
  hostProfile: /^host-profile-[A-Za-z0-9][A-Za-z0-9-]{0,127}$/,
  portForward: /^port-forward-[A-Za-z0-9][A-Za-z0-9-]{0,127}$/,
} as const;

export type WorkspaceResourceIdKind = keyof typeof RESOURCE_ID_PATTERNS;

export function isWorkspaceResourceId(kind: WorkspaceResourceIdKind, value: unknown): value is string {
  return typeof value === "string" && RESOURCE_ID_PATTERNS[kind].test(value);
}

export function canTransitionWorktree(from: WorktreeStatus, to: WorktreeStatus): boolean {
  return from === to || WORKTREE_TRANSITIONS[from].has(to);
}

export function canTransitionTerminal(from: TerminalStatus, to: TerminalStatus): boolean {
  return from === to || TERMINAL_TRANSITIONS[from].has(to);
}

export function terminalStatusAfterTransportLoss(status: TerminalStatus): TerminalStatus {
  if (status === "running" || status === "detached" || status === "reconnecting") return "reconnecting";
  return status;
}

export function assertWorktreeResource(value: unknown): asserts value is WorktreeResource {
  const record = strictRecord(value, [
    "worktreeId", "sourceWorkspaceId", "workspaceId", "repoRoot", "canonicalPath", "branch",
    "baseCommit", "status", "location", "createdAt", "updatedAt",
  ]);
  if (!isWorkspaceResourceId("worktree", record.worktreeId)) throw new Error("worktree_id_invalid");
  requireStrings(record, ["sourceWorkspaceId", "workspaceId", "repoRoot", "canonicalPath", "branch", "baseCommit", "createdAt", "updatedAt"]);
  if (record.sourceWorkspaceId === record.workspaceId) throw new Error("worktree_workspace_identity_invalid");
  if (!Object.hasOwn(WORKTREE_TRANSITIONS, String(record.status))) throw new Error("worktree_status_invalid");
  if (record.location !== "local" && record.location !== "remote") throw new Error("worktree_location_invalid");
}

export function assertTerminalResource(value: unknown): asserts value is TerminalResource {
  const record = strictRecord(value, [
    "terminalId", "runtimeId", "workspaceId", "worktreeId", "status", "generation",
    "lastSequence", "createdAt", "exitedAt",
  ]);
  if (!isWorkspaceResourceId("terminal", record.terminalId)) throw new Error("terminal_id_invalid");
  requireStrings(record, ["runtimeId", "workspaceId", "createdAt"]);
  if (record.worktreeId !== undefined && !isWorkspaceResourceId("worktree", record.worktreeId)) throw new Error("terminal_worktree_id_invalid");
  if (!Object.hasOwn(TERMINAL_TRANSITIONS, String(record.status))) throw new Error("terminal_status_invalid");
  if (!Number.isSafeInteger(record.generation) || Number(record.generation) < 1) throw new Error("terminal_generation_invalid");
  if (!Number.isSafeInteger(record.lastSequence) || Number(record.lastSequence) < 0) throw new Error("terminal_sequence_invalid");
  if (record.exitedAt !== undefined && (typeof record.exitedAt !== "string" || !record.exitedAt)) throw new Error("terminal_exited_at_invalid");
}

function strictRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("workspace_resource_invalid");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) throw new Error("workspace_resource_unknown_field");
  return record;
}

function requireStrings(record: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) {
    if (typeof record[field] !== "string" || !record[field]) throw new Error(`workspace_resource_${field}_invalid`);
  }
}
