interface CircuitState {
  failures: number[];
  openedAt?: number;
}

const FAILURE_WINDOW_MS = 60_000;
const OPEN_DURATION_MS = 30_000;
const FAILURE_THRESHOLD = 3;
const circuits = new Map<string, CircuitState>();

export function assertAgentCircuitAvailable(agentId: string, now = Date.now()): void {
  const state = circuits.get(agentId);
  if (!state?.openedAt) return;
  if (now - state.openedAt >= OPEN_DURATION_MS) {
    circuits.set(agentId, { failures: [] });
    return;
  }
  throw new Error("The selected platform agent is temporarily unavailable after repeated failures. Try again shortly.");
}

export function recordAgentCircuitFailure(agentId: string, now = Date.now()): void {
  const current = circuits.get(agentId) ?? { failures: [] };
  const failures = [...current.failures.filter((timestamp) => now - timestamp <= FAILURE_WINDOW_MS), now];
  circuits.set(agentId, {
    failures,
    ...(failures.length >= FAILURE_THRESHOLD ? { openedAt: now } : {}),
  });
}

export function recordAgentCircuitSuccess(agentId: string): void {
  circuits.delete(agentId);
}

export function resetAgentCircuitsForTest(): void {
  circuits.clear();
}
