export interface SpeechTextSegment { id: string; index: number; text: string; first: boolean; }
export interface SemanticSpeechSegmenterOptions { firstMinChars: number; normalMinChars: number; maxChars: number; firstMaxWaitMs: number; }

const DEFAULTS: SemanticSpeechSegmenterOptions = { firstMinChars: 12, normalMinChars: 32, maxChars: 180, firstMaxWaitMs: 600 };
const ABBREVIATIONS = new Set(["mr.", "mrs.", "ms.", "dr.", "prof.", "e.g.", "i.e.", "etc.", "vs."]);

export class SemanticSpeechSegmenter {
  readonly options: SemanticSpeechSegmenterOptions;
  #buffer = "";
  #index = 0;
  #startedAt: number | null = null;
  #filter = new StreamingSpeakableFilter();

  constructor(options: Partial<SemanticSpeechSegmenterOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
    if (!(this.options.firstMinChars > 0 && this.options.normalMinChars > 0 && this.options.maxChars >= this.options.normalMinChars && this.options.firstMaxWaitMs > 0)) throw new Error("Invalid semantic speech segmenter options.");
  }

  push(chunk: string, now = Date.now()): SpeechTextSegment[] {
    if (!chunk) return [];
    this.#startedAt ??= now;
    this.#buffer += this.#filter.push(chunk);
    return this.#drain(false, now);
  }

  poll(now = Date.now()): SpeechTextSegment[] { return this.#drain(false, now); }
  flush(): SpeechTextSegment[] { this.#buffer += this.#filter.flush(); return this.#drain(true, Date.now()); }
  reset(): void { this.#buffer = ""; this.#index = 0; this.#startedAt = null; this.#filter.reset(); }
  get pendingText(): string { return this.#buffer; }

  #drain(final: boolean, now: number): SpeechTextSegment[] {
    const output: SpeechTextSegment[] = [];
    while (this.#buffer.trim()) {
      const minChars = this.#index === 0 ? this.options.firstMinChars : this.options.normalMinChars;
      const waited = this.#index === 0 && this.#startedAt !== null && now - this.#startedAt >= this.options.firstMaxWaitMs;
      const boundary = findSpeechBoundary(this.#buffer, minChars, this.options.maxChars, final || waited);
      if (boundary <= 0) break;
      const raw = this.#buffer.slice(0, boundary);
      this.#buffer = this.#buffer.slice(boundary);
      const text = normalizeSegment(raw);
      if (!text) continue;
      output.push({ id: `speech-segment-${this.#index}`, index: this.#index, text, first: this.#index === 0 });
      this.#index += 1;
      this.#startedAt = now;
    }
    return output;
  }
}

export function filterSpeakableAssistantText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/<details[\s\S]*?<\/details>/gi, " ");
}

class StreamingSpeakableFilter {
  #inFence = false;
  #pendingTicks = 0;

  push(text: string): string {
    let output = "";
    for (const char of text) {
      if (char === "`") {
        this.#pendingTicks += 1;
        if (this.#pendingTicks === 3) {
          this.#inFence = !this.#inFence;
          this.#pendingTicks = 0;
          if (!output.endsWith(" ")) output += " ";
        }
        continue;
      }
      if (this.#pendingTicks) {
        if (!this.#inFence) output += "`".repeat(this.#pendingTicks);
        this.#pendingTicks = 0;
      }
      if (!this.#inFence) output += char;
    }
    return output;
  }

  flush(): string {
    const output = this.#inFence ? "" : "`".repeat(this.#pendingTicks);
    this.#pendingTicks = 0;
    return output;
  }

  reset(): void { this.#inFence = false; this.#pendingTicks = 0; }
}

export function findSpeechBoundary(text: string, minChars: number, maxChars: number, force: boolean): number {
  const limit = Math.min(text.length, maxChars);
  let fallback = -1;
  let inInlineCode = false;
  for (let index = 0; index < limit; index += 1) {
    const char = text[index];
    if (char === "`") inInlineCode = !inInlineCode;
    if (inInlineCode) continue;
    const length = index + 1;
    if (/\s/u.test(char) && length >= minChars) fallback = length;
    if (length < minChars) continue;
    if (/[。！？!?；;\n]/u.test(char)) return length;
    if (char === "." && isSafePeriodBoundary(text, index)) return length;
  }
  if (text.length >= maxChars) return fallback > 0 ? fallback : limit;
  if (force) return text.length;
  return -1;
}

function isSafePeriodBoundary(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 8), index + 1).toLowerCase();
  if ([...ABBREVIATIONS].some((abbr) => before.endsWith(abbr))) return false;
  if (/\d\.\d$/u.test(text.slice(Math.max(0, index - 1), index + 2))) return false;
  const tokenStart = Math.max(text.lastIndexOf(" ", index), text.lastIndexOf("\n", index)) + 1;
  const token = text.slice(tokenStart, index + 1);
  if (/^(?:https?:\/\/|www\.)/i.test(token)) return false;
  const next = text[index + 1];
  return next === undefined || /\s|["'”’)]/u.test(next);
}

function normalizeSegment(value: string): string { return value.replace(/\s+/g, " ").trim(); }
