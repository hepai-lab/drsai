import type { DesktopDuplexVoiceEvent, DesktopDuplexVoiceSessionStartRequest, DesktopDuplexVoiceSessionStartResult } from "../../../api/desktopApi";
import type { DuplexVoiceRuntime } from "./runtime";

export interface DuplexSessionRegistryOptions {
  maxGlobalSessions?: number;
  createRuntime: (ownerId: string, request: DesktopDuplexVoiceSessionStartRequest, emit: (event: DesktopDuplexVoiceEvent) => void) => DuplexVoiceRuntime;
  emitBatch: (ownerId: string, events: DesktopDuplexVoiceEvent[]) => void;
  scheduleFlush?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelFlush?: (timer: ReturnType<typeof setTimeout>) => void;
  onRemoved?: (ownerId: string, sessionId: string) => void;
}

interface RegistryEntry {
  ownerId: string;
  request: DesktopDuplexVoiceSessionStartRequest;
  runtime: DuplexVoiceRuntime;
  events: DesktopDuplexVoiceEvent[];
  eventBytes: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  result: DesktopDuplexVoiceSessionStartResult;
}

const MAX_BATCH_EVENTS = 24;
const MAX_BATCH_BYTES = 256 * 1024;

export class DuplexSessionRegistry {
  readonly options: DuplexSessionRegistryOptions;
  #bySession = new Map<string, RegistryEntry>();
  #byOwner = new Map<string, string>();

  constructor(options: DuplexSessionRegistryOptions) { this.options = options; }

  start(ownerId: string, request: DesktopDuplexVoiceSessionStartRequest): DesktopDuplexVoiceSessionStartResult {
    const existingId = this.#byOwner.get(ownerId);
    if (existingId) {
      const existing = this.#bySession.get(existingId);
      if (existing?.request.sessionId === request.sessionId) return existing.result;
      throw new Error("This window already owns an active Duplex Session.");
    }
    if (this.#bySession.has(request.sessionId)) throw new Error("Duplex Session identity is already active.");
    if (this.#bySession.size >= (this.options.maxGlobalSessions ?? 2)) throw new Error("Duplex Session capacity is currently occupied.");
    let entry!: RegistryEntry;
    const runtime = this.options.createRuntime(ownerId, request, (event) => this.#queue(entry, event));
    const result: DesktopDuplexVoiceSessionStartResult = {
      sessionId: request.sessionId,
      acceptedAt: new Date().toISOString(),
      runtimeId: "realtime-provider",
      providerId: request.providerId,
      modelId: request.modelId,
      capabilities: runtime.options.adapter.capabilities,
    };
    entry = { ownerId, request, runtime, events: [], eventBytes: 0, flushTimer: null, result };
    this.#bySession.set(request.sessionId, entry);
    this.#byOwner.set(ownerId, request.sessionId);
    runtime.start();
    return result;
  }

  get(sessionId: string, ownerId: string): DuplexVoiceRuntime | undefined {
    const entry = this.#bySession.get(sessionId);
    return entry?.ownerId === ownerId ? entry.runtime : undefined;
  }

  disposeSession(sessionId: string, ownerId: string): boolean {
    const entry = this.#bySession.get(sessionId);
    if (!entry || entry.ownerId !== ownerId) return false;
    entry.runtime.dispose();
    this.#flush(entry);
    this.#remove(entry);
    return true;
  }

  disposeOwner(ownerId: string): boolean {
    const sessionId = this.#byOwner.get(ownerId);
    return sessionId ? this.disposeSession(sessionId, ownerId) : false;
  }

  disposeAll(): void { for (const entry of [...this.#bySession.values()]) this.disposeSession(entry.request.sessionId, entry.ownerId); }
  snapshot(): Readonly<{ sessions: number; owners: number }> { return Object.freeze({ sessions: this.#bySession.size, owners: this.#byOwner.size }); }

  #queue(entry: RegistryEntry, event: DesktopDuplexVoiceEvent): void {
    if (!this.#bySession.has(entry.request.sessionId)) return;
    const bytes = event.type === "response_audio_delta" ? event.delta.audioData.byteLength : Buffer.byteLength(JSON.stringify(event), "utf8");
    if (bytes > MAX_BATCH_BYTES) {
      entry.runtime.cancel();
      return;
    }
    if (entry.events.length && (entry.events.length >= MAX_BATCH_EVENTS || entry.eventBytes + bytes > MAX_BATCH_BYTES)) this.#flush(entry);
    entry.events.push(event);
    entry.eventBytes += bytes;
    if (isTerminal(event)) { this.#flush(entry); this.#remove(entry); return; }
    if (entry.events.length >= MAX_BATCH_EVENTS || entry.eventBytes >= MAX_BATCH_BYTES) this.#flush(entry);
    else if (entry.flushTimer === null) entry.flushTimer = (this.options.scheduleFlush ?? setTimeout)(() => { entry.flushTimer = null; this.#flush(entry); }, 8);
  }

  #flush(entry: RegistryEntry): void {
    if (entry.flushTimer !== null) { (this.options.cancelFlush ?? clearTimeout)(entry.flushTimer); entry.flushTimer = null; }
    if (!entry.events.length) return;
    const events = entry.events;
    entry.events = [];
    entry.eventBytes = 0;
    this.options.emitBatch(entry.ownerId, events);
  }

  #remove(entry: RegistryEntry): void {
    if (entry.flushTimer !== null) { (this.options.cancelFlush ?? clearTimeout)(entry.flushTimer); entry.flushTimer = null; }
    this.#bySession.delete(entry.request.sessionId);
    if (this.#byOwner.get(entry.ownerId) === entry.request.sessionId) this.#byOwner.delete(entry.ownerId);
    this.options.onRemoved?.(entry.ownerId, entry.request.sessionId);
  }
}

function isTerminal(event: DesktopDuplexVoiceEvent): boolean { return event.type === "completed" || event.type === "cancelled" || event.type === "failed"; }
