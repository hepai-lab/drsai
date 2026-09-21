/**
 * P1: Renderer-side health monitor — measures FPS and pending event count,
 * reports to the main process at 500ms intervals so the main process can
 * apply backpressure (adjust flush delay).
 *
 * Health tiers:
 *   - healthy:  FPS ≥ 50  → 0ms flush delay
 *   - degraded: FPS 20-49 → 100ms flush delay
 *   - critical: FPS < 20  → 200ms flush delay
 */

export type RenderHealthTier = "healthy" | "degraded" | "critical";

export interface RenderHealthReport {
  fps: number;
  tier: RenderHealthTier;
  timestamp: number;
}

const REPORT_INTERVAL_MS = 500;
const FPS_HEALTHY = 50;
const FPS_DEGRADED = 20;

/** Classify FPS into a health tier. */
export function classifyFps(fps: number): RenderHealthTier {
  if (fps >= FPS_HEALTHY) return "healthy";
  if (fps >= FPS_DEGRADED) return "degraded";
  return "critical";
}

/** Get the recommended flush delay for a health tier. */
export function tierFlushDelayMs(tier: RenderHealthTier): number {
  switch (tier) {
    case "healthy": return 0;
    case "degraded": return 100;
    case "critical": return 200;
  }
}

/**
 * Starts monitoring renderer FPS and reporting to the main process.
 * Returns a stop function.
 */
export function startRenderHealthMonitor(
  onReport: (report: RenderHealthReport) => void,
): () => void {
  let frameCount = 0;
  let lastReportTime = performance.now();
  let rafId: number | null = null;
  let intervalId: number | null = null;
  let stopped = false;

  // Count animation frames
  function countFrame(): void {
    if (stopped) return;
    frameCount++;
    rafId = requestAnimationFrame(countFrame);
  }
  rafId = requestAnimationFrame(countFrame);

  // Report every REPORT_INTERVAL_MS
  intervalId = window.setInterval(() => {
    if (stopped) return;
    const now = performance.now();
    const elapsed = now - lastReportTime;
    const fps = Math.round((frameCount * 1000) / Math.max(1, elapsed));
    const tier = classifyFps(fps);
    onReport({ fps, tier, timestamp: Date.now() });
    frameCount = 0;
    lastReportTime = now;
  }, REPORT_INTERVAL_MS);

  return function stop(): void {
    stopped = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (intervalId !== null) clearInterval(intervalId);
  };
}
