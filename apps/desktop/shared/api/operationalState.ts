export type OperationalLayer = "identity" | "runtime" | "agent" | "workspace";

export interface OperationalStateFacts {
  identity: "loading" | "anonymous" | "authenticated";
  runtime: "unknown" | "preparing" | "ready" | "blocked";
  agent: "unknown" | "unavailable" | "unconfigured" | "untested" | "ready";
  workspace: "none" | "untrusted" | "trusted";
}

export interface OperationalLayerState {
  layer: OperationalLayer;
  state: string;
  status: "complete" | "current" | "pending";
}

export interface OperationalStateBlockerInfo {
  kind: string;
  title: string;
  message: string;
  diagnosticCode: string;
  retryable: boolean;
}

export interface OperationalStateDecision {
  currentLayer: OperationalLayer;
  blockingLayer: OperationalLayer | null;
  state: string;
  readyForRun: boolean;
  layers: OperationalLayerState[];
  /** Detailed blocker information when the runtime is blocked. */
  blocker?: OperationalStateBlockerInfo | null;
  /** Install status details: what runtime components are missing. */
  installMissing?: string[] | null;
}

const ORDER: OperationalLayer[] = ["identity", "runtime", "agent", "workspace"];

export function deriveOperationalState(facts: OperationalStateFacts): OperationalStateDecision {
  const blocker = facts.identity !== "authenticated"
    ? "identity"
    : facts.runtime !== "ready"
      ? "runtime"
      : facts.agent === "unconfigured" || facts.agent === "unavailable" || facts.agent === "unknown"
        ? "agent"
        : facts.workspace !== "trusted"
          ? "workspace"
          : null;
  // A configured model that has not been explicitly tested is advisory. It
  // must not block the workspace or trigger a paid probe before the user has
  // asked the model to do useful work.
  const currentLayer = blocker ?? (facts.agent === "untested" ? "agent" : "workspace");
  const state = facts[currentLayer];
  const blockingLayer = blocker;
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

export function shouldShowOperationalStateBar(decision: OperationalStateDecision): boolean {
  if (decision.blockingLayer !== null) return true;
  return decision.currentLayer === "agent" && decision.state === "untested";
}
