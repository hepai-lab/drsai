export class AdaptiveTtsPrefetchWatermark {
  #synthesisRatio = 0.5;
  #jitterMs = 0;
  #lastSynthesisMs: number | null = null;

  observe(synthesisMs: number, estimatedAudioMs: number): void {
    if (!(synthesisMs > 0) || !(estimatedAudioMs > 0)) return;
    const ratio = Math.min(4, synthesisMs / estimatedAudioMs);
    this.#synthesisRatio = this.#synthesisRatio * 0.75 + ratio * 0.25;
    if (this.#lastSynthesisMs !== null) {
      const delta = Math.abs(synthesisMs - this.#lastSynthesisMs);
      this.#jitterMs = this.#jitterMs * 0.75 + delta * 0.25;
    }
    this.#lastSynthesisMs = synthesisMs;
  }

  get targetSegments(): 1 | 2 {
    return this.#synthesisRatio >= 0.65 || this.#jitterMs >= 180 ? 2 : 1;
  }

  shouldPrefetch(bufferedPlaybackSegments: number, synthesizingSegments: number): boolean {
    return bufferedPlaybackSegments + synthesizingSegments < this.targetSegments;
  }
}

export function estimateSpeechAudioMs(text: string, speed = 1): number {
  const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu) ?? []).length;
  const other = Math.max(0, text.replace(/\s/gu, "").length - cjk);
  return Math.max(250, ((cjk / 5.2) + (other / 13)) * 1_000 / Math.max(0.5, Math.min(2, speed)));
}
