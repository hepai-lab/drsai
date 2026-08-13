export type StreamingRenderMetricKind = "markdown-render" | "commit-layout";

const MAX_SAMPLES = 240;
const samples: Record<StreamingRenderMetricKind, number[]> = {
  "markdown-render": [],
  "commit-layout": [],
};

export function observeStreamingRenderMetric(kind: StreamingRenderMetricKind, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const bucket = samples[kind];
  bucket.push(durationMs);
  if (bucket.length > MAX_SAMPLES) bucket.splice(0, bucket.length - MAX_SAMPLES);
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

export function getStreamingRenderMetrics() {
  return Object.fromEntries(Object.entries(samples).map(([kind, values]) => [kind, {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  }])) as Record<StreamingRenderMetricKind, { count: number; p50Ms: number; p95Ms: number }>;
}

export function resetStreamingRenderMetrics(): void {
  samples["markdown-render"] = [];
  samples["commit-layout"] = [];
}
