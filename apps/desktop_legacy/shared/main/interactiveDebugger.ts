import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { chmod, mkdir, readFile, rm, writeFile } from "fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { dirname, isAbsolute, join } from "path";
import type { WebContents } from "electron";
import type {
  DiagnosticSourceLocation,
  InteractiveDebugBreakpoint,
  InteractiveDebugBreakpointRequest,
  InteractiveDebugCapabilities,
  InteractiveDebugControlRequest,
  InteractiveDebugEvaluateRequest,
  InteractiveDebugEvaluateResult,
  InteractiveDebugScope,
  InteractiveDebugSession,
  InteractiveDebugStackFrame,
  InteractiveDebugStartRequest,
  InteractiveDebugTarget,
  InteractiveDebugVariable,
} from "../api/diagnostics";
import { DRSAI_HOME } from "./paths";
import { replaceFileSafely } from "./atomicFileReplace";

type DebugPublisher = (session: InteractiveDebugSession) => void;

interface DebugAdapter {
  readonly capabilities: InteractiveDebugCapabilities;
  start(request: InteractiveDebugStartRequest): Promise<void>;
  setBreakpoints(breakpoints: InteractiveDebugBreakpoint[]): Promise<InteractiveDebugBreakpoint[]>;
  control(action: InteractiveDebugControlRequest["action"], threadId?: string): Promise<void>;
  scopes(frameId: string): Promise<InteractiveDebugScope[]>;
  variables(reference: string): Promise<InteractiveDebugVariable[]>;
  evaluate(request: InteractiveDebugEvaluateRequest): Promise<InteractiveDebugEvaluateResult>;
  disconnect(terminate: boolean): Promise<void>;
  onPaused(callback: (reason: string, threadId: string | undefined, frames: InteractiveDebugStackFrame[]) => void): void;
  onContinued(callback: () => void): void;
  onStopped(callback: (message: string) => void): void;
}

interface ManagedSession {
  model: InteractiveDebugSession;
  adapter: DebugAdapter;
}

const READ_ONLY_CAPABILITIES: InteractiveDebugCapabilities = {
  supportsPause: true,
  supportsStep: true,
  supportsConditionalBreakpoints: true,
  supportsHitConditionalBreakpoints: true,
  supportsLogPoints: true,
  supportsEvaluateForHovers: true,
  supportsSetVariable: false,
  supportsTerminateRequest: true,
  supportsRemoteTargets: false,
};

export class InteractiveDebuggerService {
  private readonly sessions = new Map<string, ManagedSession>();
  private publisher: DebugPublisher | null = null;
  private persistedBreakpoints: Record<string, InteractiveDebugBreakpoint[]> | null = null;
  private readonly breakpointStateFile = join(DRSAI_HOME, "desktop", "debug-breakpoints.json");

  constructor(
    private readonly getRenderer: () => WebContents | undefined,
    private readonly pythonPath: string,
    private readonly isAllowedProgram: (path: string) => Promise<boolean> = async () => true,
    private readonly isEnabled: () => boolean = () => process.env.OPENDRSAI_ENABLE_INTERACTIVE_DEBUG === "1",
  ) {}

  setPublisher(publisher: DebugPublisher | null): void {
    this.publisher = publisher;
  }

  listTargets(): InteractiveDebugTarget[] {
    const renderer = this.getRenderer();
    const enabled = this.isEnabled();
    return [
      target("electron-renderer", "electron-renderer", "Electron Renderer", "Chromium DevTools Protocol for the active OpenDrSai window.", enabled && Boolean(renderer) && !renderer?.isDestroyed(), enabled ? undefined : "Interactive debugging is disabled by policy."),
      target("node-inspector", "node", "Node Inspector target", "Attach to an authorized Node.js inspector WebSocket URL.", enabled, enabled ? undefined : "Interactive debugging is disabled by policy."),
      target("electron-main", "electron-main", "Electron Main", "Main-process attach requires an isolated inspector controller; self-pause is blocked to prevent deadlock.", false, "Start OpenDrSai with the isolated inspector controller to enable Main-process pause."),
      target("python-local", "python", "Python Runtime", "Launch or attach through Debug Adapter Protocol and debugpy.", enabled && existsSync(this.pythonPath), enabled ? (existsSync(this.pythonPath) ? undefined : "Configured Python runtime was not found.") : "Interactive debugging is disabled by policy."),
      { ...target("python-remote", "remote-python", "Remote Python Runtime", "Attach to an authorized debugpy endpoint through the existing SSH tunnel.", enabled, enabled ? undefined : "Interactive debugging is disabled by policy."), remote: true, capabilities: { ...READ_ONLY_CAPABILITIES, supportsRemoteTargets: true } },
    ];
  }

  listSessions(): InteractiveDebugSession[] {
    return [...this.sessions.values()].map((item) => structuredClone(item.model));
  }

  async start(request: InteractiveDebugStartRequest): Promise<InteractiveDebugSession> {
    const debugTarget = this.listTargets().find((item) => item.id === request.targetId);
    if (!debugTarget) throw new Error("Debug target is unknown.");
    if (!debugTarget.available) throw new Error(debugTarget.reason || "Debug target is unavailable.");
    if (debugTarget.kind === "python" && (!request.program || !isAbsolute(request.program) || !existsSync(request.program) || !(await this.isAllowedProgram(request.program)))) {
      throw new Error("Local Python debugging requires an existing absolute program path.");
    }
    if (debugTarget.kind === "remote-python" && ((request.host && !/^(?:127\.0\.0\.1|localhost)$/i.test(request.host)) || !Number.isInteger(request.port) || Number(request.port) < 1 || Number(request.port) > 65_535)) {
      throw new Error("Remote Python debugging requires a loopback SSH-tunnel host and a valid port.");
    }
    const adapter: DebugAdapter = debugTarget.kind === "electron-renderer"
      ? new RendererCdpAdapter(assertRenderer(this.getRenderer()))
      : debugTarget.kind === "node"
        ? new WebSocketCdpAdapter()
        : new PythonDapAdapter(this.pythonPath, debugTarget.kind === "remote-python");
    const now = new Date().toISOString();
    const id = `debug-${randomUUID()}`;
    const model: InteractiveDebugSession = {
      id,
      target: debugTarget,
      state: "starting",
      startedAt: now,
      updatedAt: now,
      breakpoints: [],
      stackFrames: [],
      message: "Starting debug adapter",
      traceId: request.traceId,
      workspaceId: request.workspaceId,
    };
    const managed = { model, adapter };
    this.sessions.set(id, managed);
    adapter.onPaused((reason, threadId, frames) => this.update(id, { state: "paused", pausedReason: reason, activeThreadId: threadId, activeFrameId: frames[0]?.id, stackFrames: frames, message: `Paused: ${reason}` }));
    adapter.onContinued(() => this.update(id, { state: "running", pausedReason: undefined, stackFrames: [], activeFrameId: undefined, message: "Execution continued" }));
    adapter.onStopped((message) => this.update(id, { state: "stopped", message, stackFrames: [], activeFrameId: undefined }));
    try {
      await adapter.start(request);
      const persisted = await this.getPersistedBreakpoints();
      const restored = persisted[breakpointScopeKey(debugTarget.id, request.workspaceId)] ?? [];
      if (restored.length) model.breakpoints = await adapter.setBreakpoints(restored);
      return this.update(id, { state: "running", breakpoints: model.breakpoints, message: restored.length ? `Debug session is running; ${restored.length} breakpoint(s) restored` : "Debug session is running" });
    } catch (error) {
      this.update(id, { state: "failed", message: safeMessage(error) });
      await adapter.disconnect(false).catch(() => undefined);
      throw error;
    }
  }

  async setBreakpoint(request: InteractiveDebugBreakpointRequest): Promise<InteractiveDebugSession> {
    const managed = this.require(request.sessionId);
    if (!request.source.file || !request.source.line) throw new Error("Breakpoint source file and line are required.");
    const id = breakpointId(request.source, request.condition, request.hitCondition, request.logMessage);
    const breakpoint: InteractiveDebugBreakpoint = {
      id,
      source: request.source,
      enabled: request.enabled !== false,
      verified: false,
      condition: sanitizeExpression(request.condition),
      hitCondition: sanitizeHitCondition(request.hitCondition),
      logMessage: request.logMessage?.slice(0, 1_000),
    };
    const existing = managed.model.breakpoints.filter((item) => item.id !== id);
    managed.model.breakpoints = request.enabled === false ? existing : [...existing, breakpoint];
    managed.model.breakpoints = await managed.adapter.setBreakpoints(managed.model.breakpoints);
    const persisted = await this.getPersistedBreakpoints();
    persisted[breakpointScopeKey(managed.model.target.id, managed.model.workspaceId)] = managed.model.breakpoints;
    await this.persistBreakpoints(persisted);
    return this.update(request.sessionId, { breakpoints: managed.model.breakpoints, message: breakpoint.enabled ? "Breakpoint updated" : "Breakpoint removed" });
  }

  async control(request: InteractiveDebugControlRequest): Promise<InteractiveDebugSession> {
    const managed = this.require(request.sessionId);
    if (request.action === "disconnect" || request.action === "terminate") {
      await managed.adapter.disconnect(request.action === "terminate");
      return this.update(request.sessionId, { state: "disconnected", message: request.action === "terminate" ? "Debug target terminated" : "Debugger safely detached" });
    }
    await managed.adapter.control(request.action, request.threadId ?? managed.model.activeThreadId);
    return this.update(request.sessionId, { message: `Debug command sent: ${request.action}` });
  }

  scopes(sessionId: string, frameId: string): Promise<InteractiveDebugScope[]> {
    return this.require(sessionId).adapter.scopes(frameId);
  }

  variables(sessionId: string, reference: string): Promise<InteractiveDebugVariable[]> {
    return this.require(sessionId).adapter.variables(reference);
  }

  evaluate(request: InteractiveDebugEvaluateRequest): Promise<InteractiveDebugEvaluateResult> {
    if (!request.expression.trim() || request.expression.length > 1_000) throw new Error("Debug expression is empty or too long.");
    return this.require(request.sessionId).adapter.evaluate({ ...request, expression: request.expression.trim() });
  }

  async shutdown(): Promise<void> {
    const active = [...this.sessions.values()];
    await Promise.allSettled(active.map(({ adapter }) => adapter.disconnect(false)));
    for (const { model } of active) this.update(model.id, { state: "disconnected", message: "Debugger detached during application shutdown" });
    this.sessions.clear();
  }

  private require(id: string): ManagedSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Debug session was not found.");
    return session;
  }

  private update(id: string, patch: Partial<InteractiveDebugSession>): InteractiveDebugSession {
    const managed = this.require(id);
    managed.model = { ...managed.model, ...patch, updatedAt: new Date().toISOString() };
    const snapshot = structuredClone(managed.model);
    this.publisher?.(snapshot);
    return snapshot;
  }

  private async getPersistedBreakpoints(): Promise<Record<string, InteractiveDebugBreakpoint[]>> {
    if (this.persistedBreakpoints) return this.persistedBreakpoints;
    try {
      const parsed = JSON.parse(await readFile(this.breakpointStateFile, "utf8")) as { version?: number; scopes?: Record<string, InteractiveDebugBreakpoint[]> };
      this.persistedBreakpoints = parsed.version === 1 && parsed.scopes && typeof parsed.scopes === "object" ? parsed.scopes : {};
    } catch { this.persistedBreakpoints = {}; }
    return this.persistedBreakpoints;
  }

  private async persistBreakpoints(scopes: Record<string, InteractiveDebugBreakpoint[]>): Promise<void> {
    await mkdir(dirname(this.breakpointStateFile), { recursive: true });
    const temporary = `${this.breakpointStateFile}.${process.pid}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify({ version: 1, scopes }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); await replaceFileSafely(temporary, this.breakpointStateFile); await chmod(this.breakpointStateFile, 0o600).catch(() => undefined); }
    finally { await rm(temporary, { force: true }); }
  }
}

class RendererCdpAdapter implements DebugAdapter {
  readonly capabilities = READ_ONLY_CAPABILITIES;
  private paused: ((reason: string, threadId: string | undefined, frames: InteractiveDebugStackFrame[]) => void) | null = null;
  private continued: (() => void) | null = null;
  private stopped: ((message: string) => void) | null = null;
  private rawFrames = new Map<string, Record<string, unknown>>();

  constructor(private readonly webContents: WebContents) {}

  async start(): Promise<void> {
    if (!this.webContents.debugger.isAttached()) this.webContents.debugger.attach("1.3");
    this.webContents.debugger.on("message", this.onMessage);
    this.webContents.debugger.on("detach", (_event, reason) => this.stopped?.(`Renderer debugger detached: ${reason}`));
    await this.send("Debugger.enable");
    await this.send("Runtime.enable");
    await this.send("Debugger.setPauseOnExceptions", { state: "uncaught" });
  }

  async setBreakpoints(breakpoints: InteractiveDebugBreakpoint[]): Promise<InteractiveDebugBreakpoint[]> {
    const result: InteractiveDebugBreakpoint[] = [];
    for (const breakpoint of breakpoints) {
      if (!breakpoint.enabled || !breakpoint.source.file || !breakpoint.source.line) continue;
      try {
        const response = await this.send("Debugger.setBreakpointByUrl", {
          lineNumber: breakpoint.source.line - 1,
          columnNumber: Math.max(0, (breakpoint.source.column ?? 1) - 1),
          urlRegex: escapeRegex(normalizeSourceUrl(breakpoint.source.file)),
          condition: breakpoint.condition || logPointCondition(breakpoint.logMessage),
        }) as { breakpointId?: string; locations?: unknown[] };
        result.push({ ...breakpoint, id: response.breakpointId || breakpoint.id, verified: Boolean(response.locations?.length), message: response.locations?.length ? "Breakpoint bound" : "Breakpoint is pending script load" });
      } catch (error) {
        result.push({ ...breakpoint, verified: false, message: safeMessage(error) });
      }
    }
    return result;
  }

  control(action: InteractiveDebugControlRequest["action"]): Promise<void> {
    const command = action === "pause" ? "Debugger.pause" : action === "continue" ? "Debugger.resume" : action === "next" ? "Debugger.stepOver" : action === "step-in" ? "Debugger.stepInto" : "Debugger.stepOut";
    return this.send(command).then(() => undefined);
  }

  async scopes(frameId: string): Promise<InteractiveDebugScope[]> {
    const frame = this.rawFrames.get(frameId);
    const scopes = Array.isArray(frame?.scopeChain) ? frame.scopeChain as Array<Record<string, unknown>> : [];
    return scopes.map((scope, index) => {
      const object = scope.object as Record<string, unknown> | undefined;
      return { id: `${frameId}:${index}`, name: String(scope.name || scope.type || `Scope ${index + 1}`), variablesReference: String(object?.objectId || ""), expensive: scope.type === "global" };
    }).filter((scope) => scope.variablesReference);
  }

  async variables(reference: string): Promise<InteractiveDebugVariable[]> {
    const response = await this.send("Runtime.getProperties", { objectId: reference, ownProperties: true, accessorPropertiesOnly: false, generatePreview: true }) as { result?: Array<Record<string, unknown>> };
    return (response.result ?? []).slice(0, 500).map(toCdpVariable);
  }

  async evaluate(request: InteractiveDebugEvaluateRequest): Promise<InteractiveDebugEvaluateResult> {
    const response = await this.send("Debugger.evaluateOnCallFrame", { callFrameId: request.frameId, expression: request.expression, throwOnSideEffect: true, timeout: 1_000, returnByValue: false, generatePreview: true }) as { result?: Record<string, unknown>; exceptionDetails?: unknown };
    if (response.exceptionDetails) return { result: "", safe: false, message: "Expression was rejected or threw an exception." };
    const result = response.result ?? {};
    return { result: formatRemoteValue(result), type: typeof result.type === "string" ? result.type : undefined, variablesReference: typeof result.objectId === "string" ? result.objectId : undefined, safe: true, message: "Read-only expression evaluated without side effects." };
  }

  async disconnect(): Promise<void> {
    if (this.webContents.debugger.isAttached()) this.webContents.debugger.detach();
  }

  onPaused(callback: (reason: string, threadId: string | undefined, frames: InteractiveDebugStackFrame[]) => void): void { this.paused = callback; }
  onContinued(callback: () => void): void { this.continued = callback; }
  onStopped(callback: (message: string) => void): void { this.stopped = callback; }

  private readonly onMessage = (_event: unknown, method: string, params: Record<string, unknown>): void => {
    if (method === "Debugger.resumed") { this.rawFrames.clear(); this.continued?.(); return; }
    if (method !== "Debugger.paused") return;
    const raw = Array.isArray(params.callFrames) ? params.callFrames as Array<Record<string, unknown>> : [];
    this.rawFrames.clear();
    const frames = raw.map((frame): InteractiveDebugStackFrame => {
      const id = String(frame.callFrameId || randomUUID());
      this.rawFrames.set(id, frame);
      const location = frame.location as Record<string, unknown> | undefined;
      const url = typeof frame.url === "string" ? frame.url : undefined;
      return { id, name: String(frame.functionName || "<anonymous>"), source: url ? { file: url, line: Number(location?.lineNumber ?? 0) + 1, column: Number(location?.columnNumber ?? 0) + 1, language: "javascript" } : undefined, canRestart: false };
    });
    this.paused?.(String(params.reason || "pause"), "renderer", frames);
  };

  private send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.webContents.debugger.sendCommand(method, params);
  }
}

class WebSocketCdpAdapter implements DebugAdapter {
  readonly capabilities = READ_ONLY_CAPABILITIES;
  private socket: WebSocket | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private paused: ((reason: string, threadId: string | undefined, frames: InteractiveDebugStackFrame[]) => void) | null = null;
  private continued: (() => void) | null = null;
  private stopped: ((message: string) => void) | null = null;
  private frames = new Map<string, Record<string, unknown>>();

  async start(request: InteractiveDebugStartRequest): Promise<void> {
    if (!request.inspectorUrl || !/^wss?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(request.inspectorUrl)) throw new Error("Node inspector URL must use a loopback WebSocket endpoint.");
    this.socket = new WebSocket(request.inspectorUrl);
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Node inspector connection timed out.")), 5_000); this.socket!.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true }); this.socket!.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Node inspector connection failed.")); }, { once: true }); });
    this.socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    this.socket.addEventListener("close", () => this.stopped?.("Node inspector connection closed"));
    await this.send("Debugger.enable"); await this.send("Runtime.enable"); await this.send("Debugger.setPauseOnExceptions", { state: "uncaught" });
  }
  async setBreakpoints(breakpoints: InteractiveDebugBreakpoint[]): Promise<InteractiveDebugBreakpoint[]> { const output: InteractiveDebugBreakpoint[] = []; for (const breakpoint of breakpoints) { if (!breakpoint.source.file || !breakpoint.source.line) continue; try { const response = await this.send("Debugger.setBreakpointByUrl", { lineNumber: breakpoint.source.line - 1, columnNumber: Math.max(0, (breakpoint.source.column ?? 1) - 1), urlRegex: escapeRegex(normalizeSourceUrl(breakpoint.source.file)), condition: breakpoint.condition || logPointCondition(breakpoint.logMessage) }) as { breakpointId?: string; locations?: unknown[] }; output.push({ ...breakpoint, id: response.breakpointId || breakpoint.id, verified: Boolean(response.locations?.length) }); } catch (error) { output.push({ ...breakpoint, verified: false, message: safeMessage(error) }); } } return output; }
  control(action: InteractiveDebugControlRequest["action"]): Promise<void> { const command = action === "pause" ? "Debugger.pause" : action === "continue" ? "Debugger.resume" : action === "next" ? "Debugger.stepOver" : action === "step-in" ? "Debugger.stepInto" : "Debugger.stepOut"; return this.send(command).then(() => undefined); }
  async scopes(frameId: string): Promise<InteractiveDebugScope[]> { const frame = this.frames.get(frameId); const scopes = Array.isArray(frame?.scopeChain) ? frame.scopeChain as Array<Record<string, unknown>> : []; return scopes.map((scope, index) => ({ id: `${frameId}:${index}`, name: String(scope.name || scope.type), variablesReference: String((scope.object as Record<string, unknown> | undefined)?.objectId || ""), expensive: scope.type === "global" })).filter((scope) => scope.variablesReference); }
  async variables(reference: string): Promise<InteractiveDebugVariable[]> { const response = await this.send("Runtime.getProperties", { objectId: reference, ownProperties: true, generatePreview: true }) as { result?: Array<Record<string, unknown>> }; return (response.result ?? []).slice(0, 500).map(toCdpVariable); }
  async evaluate(request: InteractiveDebugEvaluateRequest): Promise<InteractiveDebugEvaluateResult> { const response = await this.send("Debugger.evaluateOnCallFrame", { callFrameId: request.frameId, expression: request.expression, throwOnSideEffect: true, timeout: 1_000 }) as { result?: Record<string, unknown>; exceptionDetails?: unknown }; if (response.exceptionDetails) return { result: "", safe: false, message: "Expression was rejected or threw." }; return { result: formatRemoteValue(response.result ?? {}), variablesReference: typeof response.result?.objectId === "string" ? response.result.objectId : undefined, safe: true, message: "Read-only expression evaluated." }; }
  async disconnect(): Promise<void> { this.socket?.close(); this.socket = null; }
  onPaused(callback: (reason: string, threadId: string | undefined, frames: InteractiveDebugStackFrame[]) => void): void { this.paused = callback; }
  onContinued(callback: () => void): void { this.continued = callback; }
  onStopped(callback: (message: string) => void): void { this.stopped = callback; }
  private send(method: string, params?: Record<string, unknown>): Promise<unknown> { if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Node inspector is disconnected.")); const id = ++this.sequence; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  private handleMessage(raw: string): void { let message: Record<string, unknown>; try { message = JSON.parse(raw) as Record<string, unknown>; } catch { return; } if (typeof message.id === "number") { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result); return; } if (message.method === "Debugger.resumed") { this.frames.clear(); this.continued?.(); return; } if (message.method === "Debugger.paused") { const params = message.params as Record<string, unknown>; const rawFrames = Array.isArray(params.callFrames) ? params.callFrames as Array<Record<string, unknown>> : []; const frames = rawFrames.map((frame): InteractiveDebugStackFrame => { const id = String(frame.callFrameId); this.frames.set(id, frame); const location = frame.location as Record<string, unknown>; return { id, name: String(frame.functionName || "<anonymous>"), source: typeof frame.url === "string" ? { file: frame.url, line: Number(location?.lineNumber ?? 0) + 1, column: Number(location?.columnNumber ?? 0) + 1, language: "javascript" } : undefined, canRestart: false }; }); this.paused?.(String(params.reason || "pause"), "node", frames); } }
}

// Python DAP is intentionally isolated in a child adapter process. The implementation
// negotiates capabilities and degrades with an explicit error when debugpy is absent.
class PythonDapAdapter implements DebugAdapter {
  readonly capabilities: InteractiveDebugCapabilities;
  private process: ChildProcessWithoutNullStreams | null = null;
  private sequence = 0;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private paused: ((reason: string, threadId: string | undefined, frames: InteractiveDebugStackFrame[]) => void) | null = null;
  private continued: (() => void) | null = null;
  private stopped: ((message: string) => void) | null = null;
  private initialized: (() => void) | null = null;

  constructor(private readonly pythonPath: string, private readonly remote: boolean) {
    this.capabilities = { ...READ_ONLY_CAPABILITIES, supportsRemoteTargets: remote };
  }
  async start(request: InteractiveDebugStartRequest): Promise<void> {
    this.process = spawn(this.pythonPath, ["-m", "debugpy.adapter"], { windowsHide: true, stdio: "pipe" });
    this.process.stdout.on("data", (chunk: Buffer) => { this.buffer = Buffer.concat([this.buffer, chunk]); this.parse(); });
    this.process.stderr.on("data", () => undefined);
    this.process.on("exit", (code) => this.stopped?.(`Python debug adapter exited (${code ?? "unknown"})`));
    await this.request("initialize", { clientID: "opendrsai", clientName: "OpenDrSai Desktop", adapterID: "python", pathFormat: "path", linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true, supportsVariablePaging: true, supportsRunInTerminalRequest: false });
    const initialized = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Python adapter initialization timed out.")), 8_000); this.initialized = () => { clearTimeout(timer); resolve(); }; });
    const launch = this.remote
      ? this.request("attach", { connect: { host: request.host || "127.0.0.1", port: request.port }, justMyCode: true })
      : this.request("launch", { program: request.program, cwd: request.cwd, python: this.pythonPath, justMyCode: true, stopOnEntry: request.stopOnEntry === true, console: "internalConsole" });
    await initialized;
    await this.request("configurationDone", {});
    await launch;
  }
  async setBreakpoints(breakpoints: InteractiveDebugBreakpoint[]): Promise<InteractiveDebugBreakpoint[]> { const byFile = new Map<string, InteractiveDebugBreakpoint[]>(); for (const item of breakpoints) if (item.source.file) byFile.set(item.source.file, [...(byFile.get(item.source.file) ?? []), item]); const output: InteractiveDebugBreakpoint[] = []; for (const [path, items] of byFile) { const response = await this.request("setBreakpoints", { source: { path }, breakpoints: items.map((item) => ({ line: item.source.line, column: item.source.column, condition: item.condition, hitCondition: item.hitCondition, logMessage: item.logMessage })) }); const verified = Array.isArray(response.body && (response.body as Record<string, unknown>).breakpoints) ? (response.body as Record<string, unknown>).breakpoints as Array<Record<string, unknown>> : []; output.push(...items.map((item, index) => ({ ...item, id: String(verified[index]?.id ?? item.id), verified: verified[index]?.verified === true, message: typeof verified[index]?.message === "string" ? verified[index].message : undefined }))); } return output; }
  control(action: InteractiveDebugControlRequest["action"], threadId?: string): Promise<void> { const command = action === "pause" ? "pause" : action === "continue" ? "continue" : action === "next" ? "next" : action === "step-in" ? "stepIn" : "stepOut"; return this.request(command, { threadId: Number(threadId || 1) }).then(() => undefined); }
  async scopes(frameId: string): Promise<InteractiveDebugScope[]> { const response = await this.request("scopes", { frameId: Number(frameId) }); const rows = ((response.body as Record<string, unknown> | undefined)?.scopes ?? []) as Array<Record<string, unknown>>; return rows.map((row) => ({ id: String(row.variablesReference), name: String(row.name), variablesReference: String(row.variablesReference), expensive: row.expensive === true })); }
  async variables(reference: string): Promise<InteractiveDebugVariable[]> { const response = await this.request("variables", { variablesReference: Number(reference), start: 0, count: 500 }); const rows = ((response.body as Record<string, unknown> | undefined)?.variables ?? []) as Array<Record<string, unknown>>; return rows.map((row) => sanitizeVariable({ name: String(row.name), value: String(row.value), type: typeof row.type === "string" ? row.type : undefined, variablesReference: Number(row.variablesReference) > 0 ? String(row.variablesReference) : undefined, sensitive: isSensitiveName(String(row.name)) })); }
  async evaluate(request: InteractiveDebugEvaluateRequest): Promise<InteractiveDebugEvaluateResult> { if (!isConservativePythonExpression(request.expression)) return { result: "", safe: false, message: "Expression was blocked because it may have side effects." }; const response = await this.request("evaluate", { frameId: Number(request.frameId), expression: request.expression, context: "hover" }); const body = response.body as Record<string, unknown> | undefined; const reference = body?.variablesReference; return { result: String(body?.result ?? "").slice(0, 4_000), type: typeof body?.type === "string" ? body.type : undefined, variablesReference: Number(reference) > 0 ? String(reference) : undefined, safe: true, message: "Read-only Python expression evaluated." }; }
  async disconnect(terminate: boolean): Promise<void> {
    const child = this.process;
    if (!child) return;
    await this.request("disconnect", { terminateDebuggee: terminate }).catch(() => undefined);
    if (child.exitCode === null) child.kill();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(resolve, 2_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    this.process = null;
  }
  onPaused(callback: (reason: string, threadId: string | undefined, frames: InteractiveDebugStackFrame[]) => void): void { this.paused = callback; }
  onContinued(callback: () => void): void { this.continued = callback; }
  onStopped(callback: (message: string) => void): void { this.stopped = callback; }
  private request(command: string, argumentsValue: Record<string, unknown>): Promise<Record<string, unknown>> { if (!this.process) return Promise.reject(new Error("Python debug adapter is not running.")); const seq = ++this.sequence; this.write({ seq, type: "request", command, arguments: argumentsValue }); return new Promise((resolve, reject) => this.pending.set(seq, { resolve, reject })); }
  private write(message: Record<string, unknown>): void { const body = Buffer.from(JSON.stringify(message), "utf8"); this.process!.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); this.process!.stdin.write(body); }
  private parse(): void { while (true) { const headerEnd = this.buffer.indexOf("\r\n\r\n"); if (headerEnd < 0) return; const header = this.buffer.subarray(0, headerEnd).toString("ascii"); const match = /Content-Length:\s*(\d+)/i.exec(header); if (!match) { this.buffer = this.buffer.subarray(headerEnd + 4); continue; } const length = Number(match[1]); if (this.buffer.length < headerEnd + 4 + length) return; const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8"); this.buffer = this.buffer.subarray(headerEnd + 4 + length); try { this.handle(JSON.parse(body) as Record<string, unknown>); } catch { /* invalid adapter frame */ } } }
  private async handle(message: Record<string, unknown>): Promise<void> { if (message.type === "response" && typeof message.request_seq === "number") { const pending = this.pending.get(message.request_seq); if (!pending) return; this.pending.delete(message.request_seq); if (message.success === false) pending.reject(new Error(String(message.message || "DAP request failed"))); else pending.resolve(message); return; } if (message.type !== "event") return; const body = message.body as Record<string, unknown> | undefined; if (message.event === "initialized") { this.initialized?.(); return; } if (message.event === "continued") { this.continued?.(); return; } if (message.event === "terminated" || message.event === "exited") { this.stopped?.(`Python debuggee ${message.event}`); return; } if (message.event === "stopped") { const threadId = String(body?.threadId ?? 1); const stack = await this.request("stackTrace", { threadId: Number(threadId), startFrame: 0, levels: 100 }); const rows = ((stack.body as Record<string, unknown> | undefined)?.stackFrames ?? []) as Array<Record<string, unknown>>; const frames = rows.map((row): InteractiveDebugStackFrame => ({ id: String(row.id), name: String(row.name || "<python>"), source: (row.source as Record<string, unknown> | undefined)?.path ? { file: String((row.source as Record<string, unknown>).path), line: Number(row.line || 1), column: Number(row.column || 1), language: "python" } : undefined, canRestart: false })); this.paused?.(String(body?.reason || "pause"), threadId, frames); } }
}

function target(id: string, kind: InteractiveDebugTarget["kind"], name: string, description: string, available: boolean, reason?: string): InteractiveDebugTarget { return { id, kind, name, description, available, reason, remote: false, capabilities: READ_ONLY_CAPABILITIES }; }
function assertRenderer(value: WebContents | undefined): WebContents { if (!value || value.isDestroyed()) throw new Error("Renderer target is unavailable."); return value; }
function breakpointId(source: DiagnosticSourceLocation, ...conditions: Array<string | undefined>): string { return `bp-${Buffer.from(`${source.file}:${source.line}:${source.column}:${conditions.join(":")}`).toString("base64url").slice(0, 80)}`; }
function sanitizeExpression(value: string | undefined): string | undefined { return value?.trim().slice(0, 1_000) || undefined; }
function sanitizeHitCondition(value: string | undefined): string | undefined { const clean = value?.trim(); return clean && /^(?:>=?|==|%\s*)?\s*\d{1,9}$/.test(clean) ? clean : undefined; }
function normalizeSourceUrl(file: string): string { return file.replace(/\\/g, "/").replace(/^file:\/\//, ""); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function logPointCondition(message: string | undefined): string | undefined { if (!message) return undefined; const safe = JSON.stringify(message.slice(0, 1_000)); return `console.log(${safe}), false`; }
function toCdpVariable(row: Record<string, unknown>): InteractiveDebugVariable { const name = String(row.name ?? ""); const value = row.value as Record<string, unknown> | undefined; return sanitizeVariable({ name, value: formatRemoteValue(value ?? {}), type: typeof value?.type === "string" ? value.type : undefined, variablesReference: typeof value?.objectId === "string" ? value.objectId : undefined, sensitive: isSensitiveName(name) }); }
function formatRemoteValue(value: Record<string, unknown>): string { if (typeof value.description === "string") return value.description.slice(0, 4_000); if ("value" in value) { try { return JSON.stringify(value.value).slice(0, 4_000); } catch { return String(value.value).slice(0, 4_000); } } return String(value.type || "undefined"); }
function sanitizeVariable(variable: InteractiveDebugVariable): InteractiveDebugVariable { return variable.sensitive ? { ...variable, value: "[REDACTED]", variablesReference: undefined } : { ...variable, value: variable.value.slice(0, 4_000) }; }
function isSensitiveName(name: string): boolean { return /token|secret|password|cookie|authorization|api.?key|credential/i.test(name); }
function isConservativePythonExpression(value: string): boolean { const expression = value.trim(); return expression.length <= 1_000 && /^[A-Za-z0-9_\s.\[\]'"+\-*/%<>&|!,?:]+$/.test(expression) && !/[;={}()]|\b(?:exec|eval|open|import|del|setattr|globals|locals|compile|__import__)\b/.test(expression); }
function safeMessage(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/\b(Bearer\s+)[^\s]+/gi, "$1[REDACTED]").slice(0, 1_000); }
function breakpointScopeKey(targetId: string, workspaceId: string | undefined): string { return `${targetId}:${workspaceId || "global"}`; }
