import type { DesktopBackgroundTask } from "./desktopApi";

export type OperationalLayer = "identity" | "runtime" | "model" | "workspace" | "run";
export type OperationalRunState = "idle" | "queued" | "running" | "waiting_approval" | "recovering" | "failed" | "completed" | "cancelled";

export interface OperationalStateFacts {
  identity: "loading" | "anonymous" | "authenticated";
  runtime: "unknown" | "preparing" | "ready" | "blocked";
  model: "unknown" | "unconfigured" | "untested" | "ready";
  workspace: "none" | "untrusted" | "trusted";
  run: OperationalRunState;
}

export interface OperationalLayerState {
  layer: OperationalLayer;
  state: string;
  status: "complete" | "current" | "pending";
}

export interface OperationalStateDecision {
  currentLayer: OperationalLayer;
  blockingLayer: OperationalLayer | null;
  state: string;
  readyForRun: boolean;
  layers: OperationalLayerState[];
}

const ORDER: OperationalLayer[] = ["identity", "runtime", "model", "workspace", "run"];

export function deriveOperationalState(facts: OperationalStateFacts): OperationalStateDecision {
  const blocker = facts.identity !== "authenticated"
    ? "identity"
    : facts.runtime !== "ready"
      ? "runtime"
      : facts.model === "unconfigured" || facts.model === "unknown"
        ? "model"
        : facts.workspace !== "trusted"
          ? "workspace"
          : null;
  // A configured model that has not been explicitly tested is advisory. It
  // must not block the workspace or trigger a paid probe before the user has
  // asked the model to do useful work.
  const runNeedsAttention = ["queued", "running", "waiting_approval", "recovering", "failed"].includes(facts.run);
  const currentLayer = blocker ?? (runNeedsAttention ? "run" : facts.model === "untested" ? "model" : "run");
  const state = currentLayer === "run" ? facts.run : facts[currentLayer];
  const blockingLayer = blocker ?? (["waiting_approval", "failed"].includes(facts.run) ? "run" : null);
  const currentIndex = ORDER.indexOf(currentLayer);
  return {
    currentLayer,
    blockingLayer,
    state,
    readyForRun: blocker === null,
    layers: ORDER.map((layer, index) => ({
      layer,
      state: facts[layer],
      status: index < currentIndex ? "complete" : index === currentIndex ? "current" : "pending",
    })),
  };
}

const VISIBLE_RUN_STATES = new Set<OperationalRunState>([
  "queued",
  "running",
  "waiting_approval",
  "recovering",
  "failed",
]);

export function shouldShowOperationalStateBar(decision: OperationalStateDecision): boolean {
  if (decision.blockingLayer !== null) return true;
  if (decision.currentLayer === "model" && decision.state === "untested") return true;
  return decision.currentLayer === "run"
    && VISIBLE_RUN_STATES.has(decision.state as OperationalRunState);
}

export function deriveOperationalRunState(tasks: DesktopBackgroundTask[], activeRequestId?: string | null): OperationalRunState {
  if (activeRequestId) return "running";
  const active = [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  if (active.some((task) => task.status === "waiting_approval")) return "waiting_approval";
  if (active.some((task) => task.status === "running")) return "running";
  if (active.some((task) => task.status === "queued" && Boolean(task.recoveredAt))) return "recovering";
  if (active.some((task) => task.status === "queued")) return "queued";
  const latest = active[0];
  if (!latest) return "idle";
  return latest.status === "blocked" || latest.status === "failed"
    ? "failed"
    : latest.status === "completed"
      ? "completed"
      : latest.status === "cancelled"
        ? "cancelled"
        : "idle";
}
