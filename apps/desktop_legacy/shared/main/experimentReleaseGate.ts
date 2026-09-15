import { readFile } from "node:fs/promises";
import type { ExperimentReleaseGateFeatureId, ExperimentReleaseGateState } from "../api/desktopApi";

export const EXPERIMENT_RELEASE_GATE_FEATURES = ["M31-02", "M31-03", "M31-04", "M31-05"] as const;

const missingState = (reason: ExperimentReleaseGateState["reason"]): ExperimentReleaseGateState => ({
  schema_version: "opendrsai.experiment-release-gate/1",
  enabled: false,
  required_features: [...EXPERIMENT_RELEASE_GATE_FEATURES],
  passed_features: [],
  blocking_features: [...EXPERIMENT_RELEASE_GATE_FEATURES],
  source_ledger_sha256: null,
  reason,
});

export function evaluateExperimentReleaseGateResource(raw: unknown): ExperimentReleaseGateState {
  if (!raw || typeof raw !== "object") return missingState("release_gate_resource_invalid");
  const record = raw as Partial<ExperimentReleaseGateState>;
  if (record.schema_version !== "opendrsai.experiment-release-gate/1") {
    return missingState("release_gate_resource_invalid");
  }
  const statuses = new Map<ExperimentReleaseGateFeatureId, boolean>();
  const passedInput = Array.isArray(record.passed_features) ? record.passed_features : [];
  for (const id of EXPERIMENT_RELEASE_GATE_FEATURES) statuses.set(id, passedInput.includes(id));
  const passed = EXPERIMENT_RELEASE_GATE_FEATURES.filter((id) => statuses.get(id));
  const blocking = EXPERIMENT_RELEASE_GATE_FEATURES.filter((id) => !statuses.get(id));
  const digest = typeof record.source_ledger_sha256 === "string" && /^[a-f0-9]{64}$/i.test(record.source_ledger_sha256)
    ? record.source_ledger_sha256.toLowerCase()
    : null;
  // Never trust the serialized enabled bit: recompute it from all four fixed
  // release features and a bound ledger digest.
  const enabled = blocking.length === 0 && digest !== null;
  return {
    schema_version: "opendrsai.experiment-release-gate/1",
    enabled,
    required_features: [...EXPERIMENT_RELEASE_GATE_FEATURES],
    passed_features: [...passed],
    blocking_features: [...blocking],
    source_ledger_sha256: digest,
    reason: enabled ? "all_release_evidence_passed" : "release_evidence_incomplete",
  };
}

export async function readExperimentReleaseGate(candidatePaths: readonly string[]): Promise<ExperimentReleaseGateState> {
  let sawInvalid = false;
  for (const path of candidatePaths) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      const evaluated = evaluateExperimentReleaseGateResource(parsed);
      if (evaluated.reason !== "release_gate_resource_invalid") return evaluated;
      sawInvalid = true;
    } catch (error) {
      if (error instanceof SyntaxError) sawInvalid = true;
    }
  }
  return missingState(sawInvalid ? "release_gate_resource_invalid" : "release_gate_resource_missing");
}

export function assertExperimentReleaseEnabled(state: ExperimentReleaseGateState): void {
  if (state.enabled) return;
  const error = new Error(`[experiment_release_gate_blocked] Experiment features are unavailable until release verification is complete (${state.blocking_features.join(", ") || "invalid evidence"}).`);
  Object.assign(error, { code: "experiment_release_gate_blocked", detail: { blocking_features: state.blocking_features, reason: state.reason } });
  throw error;
}
