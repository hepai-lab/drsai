import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { encodeNativeHelperRequest, NATIVE_PROTOCOL_MAX_LINE_BYTES, parseNativeHelperResponse, type NativeHelperOperation, type NativeHelperResponse } from "./nativeProtocol";
import { managedProcessRegistry, type ManagedProcessRegistration } from "../../../../shared/main/managedProcessRegistry";

export type NativeHelperState = { status: "stopped" | "starting" | "ready" | "unavailable"; capabilities: string[]; reason?: string };
type Pending = { resolve(value: NativeHelperResponse): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; abort?: () => void };

export class NativeHelperSupervisor {
  #child: ChildProcessWithoutNullStreams | null = null; #buffer = ""; #pending = new Map<string, Pending>(); #startFlight: Promise<NativeHelperState> | null = null; #stopping = false; #restartCount = 0;
  #state: NativeHelperState = { status: "stopped", capabilities: [] };
  #registration: ManagedProcessRegistration | null = null;
  constructor(readonly executablePath: string, readonly options: { timeoutMs?: number; maxRestarts?: number } = {}) {}
  state(): NativeHelperState { return { ...this.#state, capabilities: [...this.#state.capabilities] }; }
  processId(): number | undefined { return this.#child?.pid; }
  start(): Promise<NativeHelperState> {
    if (this.#state.status === "ready") return Promise.resolve(this.state());
    if (this.#startFlight) return this.#startFlight;
    this.#startFlight = this.#start().finally(() => { this.#startFlight = null; }); return this.#startFlight;
  }
  async #start(): Promise<NativeHelperState> {
    if (!existsSync(this.executablePath)) return this.#unavailable("Native Helper executable is missing.");
    if (!managedProcessRegistry.accepting) return this.#unavailable("Native Helper cannot start during application shutdown.");
    this.#state = { status: "starting", capabilities: [] }; this.#stopping = false;
    try {
      const child = spawn(this.executablePath, [], { stdio: ["pipe", "pipe", "pipe"], shell: false, env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } }); this.#child = child;
      if (!child.pid) { child.kill("SIGKILL"); throw new Error("Native Helper did not expose a process id."); }
      this.#registration = managedProcessRegistry.register({ id: "native-helper:primary", kind: "native-helper", owner: "desktop-platform", pid: child.pid, stop: () => this.stop(), forceStop: () => { if (!child.killed) child.kill("SIGKILL"); }, alive: () => child.exitCode === null && !child.killed });
      child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => this.#consume(chunk)); child.stderr.resume();
      child.once("error", (error) => this.#failAll(error)); child.once("exit", () => this.#onExit(child));
      const handshake = await this.request("handshake");
      const capabilities = Array.isArray(handshake.result?.capabilities) ? handshake.result.capabilities.filter((item): item is string => typeof item === "string") : [];
      if (handshake.result?.protocolVersion !== 1) throw new Error("Native Helper handshake protocol is incompatible.");
      this.#restartCount = 0; this.#registration.transition("running"); this.#state = { status: "ready", capabilities }; return this.state();
    } catch (error) {
      const failed = this.#child; failed?.kill("SIGKILL");
      if (failed && failed.exitCode === null) await new Promise<void>((resolve) => failed.once("exit", () => resolve()));
      if (!this.#stopping && this.#restartCount++ < (this.options.maxRestarts ?? 1)) return this.#start();
      return this.#unavailable(error instanceof Error ? error.message : "Native Helper failed to start.");
    }
  }
  request(operation: NativeHelperOperation, signal?: AbortSignal, parameters: Record<string, string> = {}): Promise<NativeHelperResponse> {
    const child = this.#child; if (!child || child.killed) return Promise.reject(new Error("Native Helper is unavailable."));
    const requestId = randomUUID(); const timeoutMs = Math.max(50, Math.min(this.options.timeoutMs ?? 2_000, 30_000));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(requestId); reject(new Error("Native Helper request timed out.")); }, timeoutMs);
      const abort = signal ? () => { clearTimeout(timer); this.#pending.delete(requestId); reject(new Error("Native Helper request was cancelled.")); } : undefined;
      if (signal?.aborted) { clearTimeout(timer); reject(new Error("Native Helper request was cancelled.")); return; }
      if (abort) signal!.addEventListener("abort", abort, { once: true }); this.#pending.set(requestId, { resolve, reject, timer, abort });
      child.stdin.write(encodeNativeHelperRequest(requestId, operation, parameters));
    });
  }
  async stop(): Promise<void> {
    this.#stopping = true; const child = this.#child; if (!child) { this.#state = { status: "stopped", capabilities: [] }; return; }
    this.#registration?.transition("stopping");
    await Promise.race([this.request("shutdown").catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 500))]);
    if (this.#child === child) child.kill("SIGTERM");
    if (child.exitCode === null) await Promise.race([new Promise<void>((resolve) => child.once("exit", () => resolve())), new Promise<void>((resolve) => setTimeout(resolve, 500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    if (this.#child === child) { this.#registration?.exited(child.exitCode, child.signalCode ?? "SIGTERM"); this.#registration = null; this.#child = null; }
    this.#failAll(new Error("Native Helper stopped.")); this.#state = { status: "stopped", capabilities: [] };
  }
  #consume(chunk: string): void {
    this.#buffer += chunk; if (Buffer.byteLength(this.#buffer, "utf8") > NATIVE_PROTOCOL_MAX_LINE_BYTES * 2) { this.#child?.kill("SIGKILL"); this.#failAll(new Error("Native Helper output buffer exceeded its limit.")); return; }
    for (;;) { const newline = this.#buffer.indexOf("\n"); if (newline < 0) return; const line = this.#buffer.slice(0, newline); this.#buffer = this.#buffer.slice(newline + 1); if (!line) continue;
      try { const response = parseNativeHelperResponse(line); const pending = this.#pending.get(response.requestId); if (!pending) continue; clearTimeout(pending.timer); if (pending.abort) pending.abort = undefined; this.#pending.delete(response.requestId); response.status === "error" ? pending.reject(new Error(`${response.error?.code ?? "native_error"}: ${response.error?.message ?? "Native Helper request failed."}`)) : pending.resolve(response); } catch (error) { this.#child?.kill("SIGKILL"); this.#failAll(error instanceof Error ? error : new Error("Native Helper response is invalid.")); }
    }
  }
  #onExit(child: ChildProcessWithoutNullStreams): void {
    if (this.#child !== child) return; const wasReady = this.#state.status === "ready"; if (this.#stopping) this.#registration?.exited(child.exitCode, child.signalCode); else this.#registration?.crashed(child.exitCode, child.signalCode); this.#registration = null; this.#child = null; this.#failAll(new Error("Native Helper exited."));
    if (this.#stopping) return;
    if (!wasReady) return;
    const maximum = this.options.maxRestarts ?? 1;
    if (this.#restartCount++ >= maximum) { this.#unavailable("Native Helper restart budget was exhausted."); return; }
    this.#state = { status: "unavailable", capabilities: [], reason: "Native Helper exited; bounded restart scheduled." };
    const restart = () => { const timer = setTimeout(() => { void this.start(); }, 25); timer.unref?.(); };
    const activeStart = this.#startFlight; if (activeStart) void activeStart.then(restart, restart); else restart();
  }
  #failAll(error: Error): void { for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.#pending.clear(); }
  #unavailable(reason: string): NativeHelperState { this.#state = { status: "unavailable", capabilities: [], reason }; return this.state(); }
}
