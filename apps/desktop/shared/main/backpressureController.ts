/**
 * P1: BackpressureController — adaptive flush delay based on renderer health.
 *
 * The renderer reports FPS every 500ms. The controller classifies the report
 * into a tier and adjusts the flush delay:
 *   - healthy:  0ms   (flush immediately)
 *   - degraded: 100ms (coalesce more aggressively)
 *   - critical: 200ms (max coalescing, drop non-essential events)
 *
 * The controller is integrated into BoundedEventDispatcher by providing an
 * adaptive schedule function that uses the current flush delay.
 */

import type { RenderHealthTier } from "../renderer/src/renderHealthMonitor";

export interface BackpressureState {
  tier: RenderHealthTier;
  flushDelayMs: number;
  lastFps: number;
  lastReportAt: number;
}

const TIER_DELAYS: Record<RenderHealthTier, number> = {
  healthy: 0,
  degraded: 100,
  critical: 200,
};

/** Time after which a tier is considered stale (no recent reports). */
const STALE_MS = 5000;

export class BackpressureController {
  #state: BackpressureState = {
    tier: "healthy",
    flushDelayMs: 0,
    lastFps: 60,
    lastReportAt: 0,
  };

  get state(): BackpressureState { return { ...this.#state }; }

  get currentFlushDelayMs(): number { return this.#state.flushDelayMs; }

  get currentTier(): RenderHealthTier { return this.#state.tier; }

  /**
   * Update the controller with a new health report from the renderer.
   * Returns the new flush delay.
   */
  update(fps: number, tier: RenderHealthTier): number {
    this.#state = {
      tier,
      flushDelayMs: TIER_DELAYS[tier],
      lastFps: fps,
      lastReportAt: Date.now(),
    };
    return this.#state.flushDelayMs;
  }

  /**
   * Check if the controller hasn't received a report in STALE_MS.
   * If stale, reset to healthy (assume renderer recovered or stopped streaming).
   */
  checkStale(): boolean {
    if (Date.now() - this.#state.lastReportAt > STALE_MS) {
      this.#state = {
        tier: "healthy",
        flushDelayMs: 0,
        lastFps: 60,
        lastReportAt: 0,
      };
      return true;
    }
    return false;
  }

  /**
   * Create an adaptive schedule function for BoundedEventDispatcher.
   * Uses the current flush delay to schedule flush calls.
   */
  createAdaptiveScheduler(): (flush: () => void) => unknown {
    return (flush: () => void) => {
      const delay = this.#state.flushDelayMs;
      if (delay <= 0) {
        return setImmediate(flush);
      }
      return setTimeout(flush, delay);
    };
  }
}
