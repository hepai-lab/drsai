export type RuntimeRestartRecoveryDecision =
  | { kind: "terminal"; status: "completed" | "failed" | "cancelled"; reexecute: false }
  | { kind: "reconnect"; status: "queued" | "running" | "waiting_approval"; reexecute: false }
  | { kind: "interrupted"; status: "queued" | "running" | "waiting_approval"; reexecute: false; actions: readonly ["continue", "redo", "abandon"] };

export function decideRuntimeRestartRecovery(
  run: { status: string; runtime_id?: string; instance_id?: string },
  runtime: { runtime_id: string; instance_id: string },
): RuntimeRestartRecoveryDecision {
  if (["completed", "failed", "cancelled"].includes(run.status)) {
    return { kind: "terminal", status: run.status as "completed" | "failed" | "cancelled", reexecute: false };
  }
  const status = (["queued", "running", "waiting_approval"].includes(run.status)
    ? run.status : "running") as "queued" | "running" | "waiting_approval";
  if (run.runtime_id === runtime.runtime_id && run.instance_id === runtime.instance_id) {
    return { kind: "reconnect", status, reexecute: false };
  }
  return { kind: "interrupted", status, reexecute: false, actions: ["continue", "redo", "abandon"] };
}
