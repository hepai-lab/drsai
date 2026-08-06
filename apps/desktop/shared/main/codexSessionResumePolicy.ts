import type { RuntimeBackendSessionBindingStatus } from "./runtimeClient";

/**
 * Presentation policy for an authoritative Runtime binding state. Thread
 * names, archive metadata and previous Run ids deliberately are not inputs.
 */
export function codexContinuationAction(
  status: RuntimeBackendSessionBindingStatus,
): "continue" | "bind" | "create" | "recover" | "conflict" {
  if (status.state === "bound") return "continue";
  if (status.state === "unbound") return "bind";
  if (status.state === "recovery-required") return "recover";
  if (status.state === "conflict") return "conflict";
  return "create";
}
