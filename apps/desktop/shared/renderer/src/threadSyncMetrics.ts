export type ThreadSyncMetricStage = "transport" | "apply" | "render" | "resync";

export class ThreadSyncMetrics {
  private readonly values: Record<ThreadSyncMetricStage, number[]> = {
    transport: [], apply: [], render: [], resync: [],
  };

  constructor(private readonly enabled = true, private readonly maximumSamples = 256) {}

  observe(stage: ThreadSyncMetricStage, durationMs: number): void {
    if (!this.enabled || !Number.isFinite(durationMs) || durationMs < 0) return;
    const samples = this.values[stage];
    samples.push(Math.min(durationMs, 300_000));
    if (samples.length > this.maximumSamples) samples.splice(0, samples.length - this.maximumSamples);
  }

  snapshot(): Record<ThreadSyncMetricStage, { count: number; p95Ms: number; maximumMs: number }> {
    return Object.fromEntries(Object.entries(this.values).map(([stage, samples]) => {
      const sorted = [...samples].sort((left, right) => left - right);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
      return [stage, { count: sorted.length, p95Ms: p95, maximumMs: sorted.at(-1) ?? 0 }];
    })) as Record<ThreadSyncMetricStage, { count: number; p95Ms: number; maximumMs: number }>;
  }
}

export const threadSyncMetrics = new ThreadSyncMetrics();
