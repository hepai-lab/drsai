import { createHash, randomUUID } from "node:crypto";
import type { DesktopApprovalDecisionRequest, DesktopApprovalProposalRequest, DesktopApprovalProposalResult, DesktopPendingApproval } from "../api/desktopApi";
import { createExecutionPolicy, evaluateExecutionPermission, getExecutionActionRisk } from "../api/executionPolicy";
import { readDurableJson, writeDurableJson } from "./durableJsonStore";

interface ApprovalFile { schemaVersion: 1; pending: DesktopPendingApproval[]; decisions: ApprovalDecisionRecord[] }
interface ApprovalDecisionRecord { id: string; approved: boolean; reason: "approved" | "reject" | "cancel" | "expired"; decidedAt: string }
export type ApprovalExecutor = (approval: DesktopPendingApproval) => Promise<boolean>;
export type ApprovalDecisionObserver = (approved: boolean, approval: DesktopPendingApproval) => Promise<void>;
type PreparedApprovalDecision = { kind: "missing" } | { kind: "finished" | "execute"; approval: DesktopPendingApproval };

const MAX_PENDING = 500;
const MAX_DECISIONS = 2_000;
const MAX_APPROVAL_STORE_BYTES = 16 * 1024 * 1024;
const DEFAULT_TTL_MS = 24 * 60 * 60_000;
const SOURCES = new Set(["shell", "workspace", "git", "fork", "workflow", "network", "connector"]);
const ACTIONS = new Set(["chat.model_call", "browser.read", "browser.interact", "browser.sensitive_interact", "workspace.read", "workspace.diff", "workspace.stage", "workspace.revert", "workspace.checkpoint", "terminal.create", "terminal.write", "shell.command", "git.commit", "fork.lifecycle", "fork.queue_start", "workflow.run", "network.request", "external.service"]);
const SOURCE_ACTIONS: Record<DesktopApprovalProposalRequest["source"], Set<string>> = {
  shell: new Set(["terminal.create", "terminal.write", "shell.command"]),
  workspace: new Set(["workspace.stage", "workspace.revert", "workspace.checkpoint"]),
  git: new Set(["git.commit"]),
  fork: new Set(["fork.lifecycle", "fork.queue_start"]),
  workflow: new Set(["workflow.run"]),
  network: new Set(["network.request"]),
  connector: new Set(["external.service"]),
};

export class PersistentApprovalStore {
  readonly #filePath: string;
  readonly #clock: () => Date;
  readonly #ttlMs: number;
  readonly #executors = new Map<string, ApprovalExecutor>();
  readonly #decisionObservers = new Map<string, ApprovalDecisionObserver>();
  readonly #deciding = new Set<string>();
  #needsStartupRecovery = true;
  #queue = Promise.resolve();

  constructor(filePath: string, options: { clock?: () => Date; ttlMs?: number } = {}) {
    this.#filePath = filePath; this.#clock = options.clock ?? (() => new Date()); this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  async propose(raw: unknown, executor?: ApprovalExecutor, decisionObserver?: ApprovalDecisionObserver): Promise<DesktopApprovalProposalResult> {
    const request = validateProposal(raw);
    const decision = evaluateExecutionPermission(request.actionKind, createExecutionPolicy({ dangerous_allowed: true }));
    if (!decision.allowed) return { queued: false, allowed: false, requiresApproval: false, blocked: true, reason: decision.reason };
    if (!decision.requiresApproval) return { queued: false, allowed: true, requiresApproval: false, blocked: false, reason: decision.reason };
    return this.#mutate<DesktopApprovalProposalResult>(async (state) => {
      expire(state, this.#clock(), this.#ttlMs);
      const id = approvalId(request);
      const decided = state.decisions.find((item) => item.id === id);
      if (decided?.approved) return { state, value: { queued: false, alreadyExecuted: true, allowed: true, requiresApproval: false, blocked: false, reason: "This idempotent approval was already executed." } };
      const existing = state.pending.find((item) => item.id === id);
      const approval = existing ?? toApproval(id, request, this.#clock);
      if (!existing) state.pending = [approval, ...state.pending].slice(0, MAX_PENDING);
      if (executor) this.#executors.set(id, executor);
      if (decisionObserver) this.#decisionObservers.set(id, decisionObserver);
      return { state, value: { queued: true, approval, allowed: true, requiresApproval: true, blocked: false, reason: decision.reason } };
    });
  }

  async list(): Promise<DesktopPendingApproval[]> {
    return this.#mutate(async (state) => { expire(state, this.#clock(), this.#ttlMs); return { state, value: [...state.pending].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }; });
  }

  async decide(raw: unknown): Promise<boolean> {
    const request = validateDecision(raw);
    if (this.#deciding.has(request.id)) return false;
    this.#deciding.add(request.id);
    try {
      const prepared = await this.#mutate<PreparedApprovalDecision>(async (state) => {
        expire(state, this.#clock(), this.#ttlMs);
        const approval = state.pending.find((item) => item.id === request.id);
        if (!approval) return { state, value: { kind: "missing" as const } };
        if (!request.approved || approval.executionState === "ambiguous") {
          finishDecision(state, approval, request.approved, request.reason, this.#clock);
          return { state, value: { kind: "finished" as const, approval } };
        }
        if (approval.executionState === "executing" || !this.#executors.has(request.id)) return { state, value: { kind: "missing" as const } };
        const executing = { ...approval, executionState: "executing" as const };
        state.pending = state.pending.map((item) => item.id === request.id ? executing : item);
        return { state, value: { kind: "execute" as const, approval: executing } };
      });
      if (prepared.kind === "missing") return false;
      if (prepared.kind === "finished") {
        const observer = this.#decisionObservers.get(request.id);
        if (observer) await observer(request.approved, prepared.approval);
        this.#executors.delete(request.id); this.#decisionObservers.delete(request.id);
        return true;
      }
      try {
        const executor = this.#executors.get(request.id)!;
        if (!(await executor(prepared.approval))) throw new Error("Approval executor did not confirm completion.");
        const observer = this.#decisionObservers.get(request.id);
        if (observer) await observer(true, prepared.approval);
        await this.#mutate(async (state) => { finishDecision(state, prepared.approval, true, undefined, this.#clock); return { state, value: undefined }; });
        this.#executors.delete(request.id); this.#decisionObservers.delete(request.id);
        return true;
      } catch (error) {
        await this.#mutate(async (state) => {
          state.pending = state.pending.map((item) => item.id === request.id ? { ...item, executionState: "ambiguous" as const } : item);
          return { state, value: undefined };
        });
        throw error;
      }
    } finally { this.#deciding.delete(request.id); }
  }

  async shutdown(): Promise<void> { await this.#queue.catch(() => undefined); this.#executors.clear(); this.#decisionObservers.clear(); }

  async #mutate<T>(operation: (state: ApprovalFile) => Promise<{ state: ApprovalFile; value: T }>): Promise<T> {
    const run = this.#queue.catch(() => undefined).then(async () => { const result = await operation(await this.#read()); await this.#write(result.state); return result.value; });
    this.#queue = run.then(() => undefined, () => undefined); return run;
  }
  async #read(): Promise<ApprovalFile> {
    const state = (await readDurableJson(this.#filePath, decodeApprovalFile, { maxBytes: MAX_APPROVAL_STORE_BYTES }))?.value ?? { schemaVersion: 1 as const, pending: [], decisions: [] };
    if (this.#needsStartupRecovery) {
      this.#needsStartupRecovery = false;
      state.pending = state.pending.map((item) => item.executionState === "executing" ? { ...item, executionState: "ambiguous" as const } : item);
    }
    return state;
  }
  async #write(state: ApprovalFile): Promise<void> {
    await writeDurableJson(this.#filePath, state, { maxBytes: MAX_APPROVAL_STORE_BYTES });
  }
}

function validateProposal(raw: unknown): DesktopApprovalProposalRequest {
  if (!raw || typeof raw !== "object") throw new Error("Approval proposal must be an object.");
  const value = raw as Partial<DesktopApprovalProposalRequest>;
  if (!SOURCES.has(String(value.source)) || !ACTIONS.has(String(value.actionKind)) || typeof value.title !== "string" || !value.title.trim() || value.title.length > 200 || typeof value.detail !== "string" || !value.detail.trim() || value.detail.length > 4_000) throw new Error("Approval proposal is invalid.");
  if (!SOURCE_ACTIONS[value.source as DesktopApprovalProposalRequest["source"]]?.has(String(value.actionKind))) throw new Error("Approval proposal has an invalid source/action pair.");
  if (value.idempotencyKey !== undefined && (typeof value.idempotencyKey !== "string" || !/^[a-zA-Z0-9_.:-]{8,160}$/.test(value.idempotencyKey))) throw new Error("Approval idempotency key is invalid.");
  return value as DesktopApprovalProposalRequest;
}
function validateDecision(raw: unknown): DesktopApprovalDecisionRequest {
  if (!raw || typeof raw !== "object") throw new Error("Approval decision must be an object.");
  const value = raw as Partial<DesktopApprovalDecisionRequest>;
  if (typeof value.id !== "string" || !/^approval:[a-f0-9-]{36,64}$/.test(value.id) || typeof value.approved !== "boolean" || (value.reason !== undefined && value.reason !== "reject" && value.reason !== "cancel")) throw new Error("Approval decision is invalid.");
  return value as DesktopApprovalDecisionRequest;
}
function approvalId(request: DesktopApprovalProposalRequest): string {
  if (!request.idempotencyKey) return `approval:${randomUUID()}`;
  return `approval:${createHash("sha256").update(`${request.source}\0${request.actionKind}\0${request.idempotencyKey}`).digest("hex")}`;
}
function toApproval(id: string, request: DesktopApprovalProposalRequest, clock: () => Date): DesktopPendingApproval {
  const clean = (value: string | undefined, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
  return { id, source: request.source, actionKind: request.actionKind, title: request.title.trim(), detail: request.detail.trim(), businessAction: clean(request.businessAction, 160), businessObject: clean(request.businessObject, 240), target: clean(request.target, 2_048), scope: clean(request.scope, 240), impact: clean(request.impact, 320), createdAt: clock().toISOString(), risk: request.risk ?? getExecutionActionRisk(request.actionKind), ...(request.checklist ? { checklist: request.checklist } : {}) };
}
function expire(state: ApprovalFile, now: Date, ttlMs: number): void {
  const cutoff = now.getTime() - ttlMs; const expired = state.pending.filter((item) => new Date(item.createdAt).getTime() <= cutoff);
  if (!expired.length) return;
  state.pending = state.pending.filter((item) => !expired.includes(item));
  state.decisions.unshift(...expired.map((item) => ({ id: item.id, approved: false, reason: "expired" as const, decidedAt: now.toISOString() })));
  state.decisions = state.decisions.slice(0, MAX_DECISIONS);
}
function isApproval(value: unknown): value is DesktopPendingApproval { const item = value as Partial<DesktopPendingApproval>; return Boolean(item && typeof item.id === "string" && /^approval:/.test(item.id) && SOURCES.has(String(item.source)) && ACTIONS.has(String(item.actionKind)) && typeof item.title === "string" && typeof item.detail === "string" && typeof item.createdAt === "string" && (item.executionState === undefined || item.executionState === "executing" || item.executionState === "ambiguous")); }
function isDecision(value: unknown): value is ApprovalDecisionRecord { const item = value as Partial<ApprovalDecisionRecord>; return Boolean(item && typeof item.id === "string" && typeof item.approved === "boolean" && typeof item.decidedAt === "string" && ["approved", "reject", "cancel", "expired"].includes(String(item.reason))); }
function decodeApprovalFile(value: unknown): ApprovalFile { if (!value || typeof value !== "object") throw new Error("Approval store schema is invalid."); const raw = value as Partial<ApprovalFile>; if (!Array.isArray(raw.pending) || !Array.isArray(raw.decisions)) throw new Error("Approval store schema is invalid."); return { schemaVersion: 1, pending: raw.pending.filter(isApproval).slice(0, MAX_PENDING), decisions: raw.decisions.filter(isDecision).slice(0, MAX_DECISIONS) }; }
function finishDecision(state: ApprovalFile, approval: DesktopPendingApproval, approved: boolean, requestedReason: "reject" | "cancel" | undefined, clock: () => Date): void {
  state.pending = state.pending.filter((item) => item.id !== approval.id);
  const reason: ApprovalDecisionRecord["reason"] = approved ? "approved" : requestedReason ?? "reject";
  state.decisions = [{ id: approval.id, approved, reason, decidedAt: clock().toISOString() }, ...state.decisions].slice(0, MAX_DECISIONS);
}
