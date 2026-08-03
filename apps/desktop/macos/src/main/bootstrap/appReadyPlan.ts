export interface MacosAppReadyStep {
  name: string;
  critical: boolean;
  run(): void | Promise<void>;
}

export interface MacosAppReadyFailure {
  name: string;
  critical: boolean;
  error: unknown;
}

export interface MacosAppReadyResult {
  completed: string[];
  degraded: MacosAppReadyFailure[];
}

export async function runMacosAppReadyPlan(
  steps: readonly MacosAppReadyStep[],
  onFailure: (failure: MacosAppReadyFailure) => void | Promise<void> = () => undefined,
): Promise<MacosAppReadyResult> {
  const completed: string[] = [];
  const degraded: MacosAppReadyFailure[] = [];
  for (const step of steps) {
    try {
      await step.run();
      completed.push(step.name);
    } catch (error) {
      const failure = { name: step.name, critical: step.critical, error };
      await onFailure(failure);
      if (step.critical) throw error;
      degraded.push(failure);
    }
  }
  return { completed, degraded };
}
