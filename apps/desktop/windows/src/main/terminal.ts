import type { IpcMainInvokeEvent, WebContents } from "electron";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { delimiter, join } from "path";
import { getRemoteGatewayAccess } from "./remoteWorkspace";
import { requestRemotePtyKill } from "./remotePtyLifecycle";
import { connectRuntimeClientForWorkspace, type RuntimeClient } from "./runtimeClient";
import { DRSAI_HOME } from "./paths";
import { reconcileTerminalReplay } from "./terminalReplay";

type IPty = import("node-pty").IPty;
type IPtyForkOptions = import("node-pty").IPtyForkOptions;
type NodePty = typeof import("node-pty");

export interface TerminalCreateOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  workspaceKey?: string;
  title?: string;
  shellProfile?: TerminalShellProfile;
  remoteHostAlias?: string;
  workspaceId?: string;
}

export type TerminalShellProfile =
  | "powershell"
  | "pwsh"
  | "cmd"
  | "git-bash"
  | "wsl";

export interface TerminalSessionInfo {
  id: string;
  pid: number;
  shell: string;
  shellProfile: TerminalShellProfile;
  cwd: string;
  title: string;
  workspaceKey: string;
  createdAt: string;
  workspaceId?: string;
}

interface TerminalSession extends TerminalSessionInfo {
  pty?: IPty;
  remoteSocket?: WebSocket;
  ownerId: number;
  buffer: string;
  runtimeClient?: RuntimeClient;
  leaseId?: string;
  sequence?: number;
  generation?: number;
  needsSnapshot?: boolean;
  pollTimer?: NodeJS.Timeout;
  sender?: WebContents;
  detached?: boolean;
}

const sessions = new Map<string, TerminalSession>();
interface TerminalProjection {
  id: string; workspaceId: string; workspaceKey: string; title: string;
  shellProfile: TerminalShellProfile; sequence: number; generation: number;
}
const TERMINAL_PROJECTIONS_PATH = join(DRSAI_HOME, "desktop", "terminal-projections.json");
const terminalProjections = new Map<string, TerminalProjection>(loadTerminalProjections().map((item) => [item.id, item]));
const MAX_BUFFER_LENGTH = 200_000;
const POWERSHELL_READLINE_SETUP = [
  "if (Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue) {",
  "Set-PSReadLineOption -HistorySaveStyle SaveNothing;",
  "Set-PSReadLineOption -Colors @{",
  "Command = '#111827';",
  "Parameter = '#374151';",
  "String = '#047857';",
  "Operator = '#374151';",
  "Variable = '#7c3aed';",
  "Number = '#b45309';",
  "Type = '#0369a1';",
  "Member = '#0369a1';",
  "Error = '#dc2626'",
  "}",
  "}",
].join(" ");

function clampDimension(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function findOnPath(command: string): string | null {
  const pathValue = process.env.PATH ?? "";
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolvePwshExe(): string {
  const programFiles = process.env.ProgramFiles;
  const candidates = [
    programFiles ? join(programFiles, "PowerShell", "7", "pwsh.exe") : null,
    findOnPath("pwsh.exe"),
    "pwsh.exe",
  ].filter(Boolean) as string[];

  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    candidates[candidates.length - 1]
  );
}

function resolveWindowsPowerShellExe(): string {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const candidates = [
    join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    findOnPath("powershell.exe"),
    "powershell.exe",
  ].filter(Boolean) as string[];

  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    candidates[candidates.length - 1]
  );
}

function resolveGitBashExe(): string {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const candidates = [
    programFiles ? join(programFiles, "Git", "bin", "bash.exe") : null,
    programFilesX86 ? join(programFilesX86, "Git", "bin", "bash.exe") : null,
    findOnPath("bash.exe"),
    "bash.exe",
  ].filter(Boolean) as string[];

  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    candidates[candidates.length - 1]
  );
}

function normalizeShellProfile(profile: unknown): TerminalShellProfile {
  if (
    profile === "powershell" ||
    profile === "pwsh" ||
    profile === "cmd" ||
    profile === "git-bash" ||
    profile === "wsl"
  ) {
    return profile;
  }
  return "powershell";
}

function resolveShell(profile: TerminalShellProfile): { file: string; args: string[] } {
  if (process.platform === "win32") {
    if (profile === "pwsh")
      return {
        file: resolvePwshExe(),
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NoExit",
          "-Command",
          POWERSHELL_READLINE_SETUP,
        ],
      };
    if (profile === "cmd")
      return { file: process.env.ComSpec || "cmd.exe", args: [] };
    if (profile === "git-bash")
      return { file: resolveGitBashExe(), args: ["--login", "-i"] };
    if (profile === "wsl") return { file: findOnPath("wsl.exe") || "wsl.exe", args: [] };
    return {
      file: resolveWindowsPowerShellExe(),
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NoExit",
        "-Command",
        POWERSHELL_READLINE_SETUP,
      ],
    };
  }

  return { file: process.env.SHELL || "/bin/bash", args: [] };
}

function loadNodePty(): NodePty {
  // node-pty is native; defer loading until the user opens the terminal.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node-pty") as NodePty;
}

function sessionForOwner(id: string, ownerId: number): TerminalSession | null {
  const session = sessions.get(id);
  if (!session || session.ownerId !== ownerId) return null;
  return session;
}

function appendSessionBuffer(session: TerminalSession, data: string): void {
  session.buffer += data;
  if (session.buffer.length > MAX_BUFFER_LENGTH) {
    session.buffer = session.buffer.slice(
      session.buffer.length - MAX_BUFFER_LENGTH,
    );
  }
}

function toSessionInfo(session: TerminalSession): TerminalSessionInfo {
  return {
    id: session.id,
    pid: session.pid,
    shell: session.shell,
    shellProfile: session.shellProfile,
    cwd: session.cwd,
    title: session.title,
    workspaceKey: session.workspaceKey,
    createdAt: session.createdAt,
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
  };
}

export async function createTerminalSession(
  event: IpcMainInvokeEvent,
  options: TerminalCreateOptions = {},
): Promise<TerminalSessionInfo> {
  const shellProfile = normalizeShellProfile(options.shellProfile);
  let shell = resolveShell(shellProfile);
  const remoteAlias = typeof options.remoteHostAlias === "string" && /^[A-Za-z0-9_.@-]{1,128}$/.test(options.remoteHostAlias) ? options.remoteHostAlias : undefined;
  const cwd = remoteAlias && typeof options.cwd === "string" && options.cwd.trim()
    ? options.cwd.trim()
    :
    typeof options.cwd === "string" &&
    options.cwd.trim() &&
    existsSync(options.cwd)
      ? options.cwd
      : homedir();
  const cols = clampDimension(options.cols, 100, 20, 500);
  const rows = clampDimension(options.rows, 30, 5, 200);
  if (options.workspaceId) {
    return createRuntimeTerminalSession(event, options, cwd, cols, rows, shellProfile, remoteAlias ? { file: "/bin/bash", args: ["-l"] } : shell);
  }
  if (remoteAlias) {
    if (process.env.OPENDRSAI_ENABLE_LEGACY_REMOTE_PTY === "1") {
      return createRemoteTerminalSession(event, options, cwd, cols, rows, shellProfile);
    }
    throw new Error("Remote Terminal requires an authoritative Remote Runtime Workspace ID.");
  }
  if (process.env.OPENDRSAI_ENABLE_LEGACY_DESKTOP_PTY !== "1") {
    throw new Error("Local Terminal requires an open Runtime Workspace.");
  }
  const nodePty = loadNodePty();
  const id = randomUUID();
  const workspaceKey =
    typeof options.workspaceKey === "string" && options.workspaceKey.trim()
      ? options.workspaceKey
      : cwd;
  const title =
    typeof options.title === "string" && options.title.trim()
      ? options.title.trim().slice(0, 40)
      : `Terminal ${sessions.size + 1}`;

  const ptyOptions: IPtyForkOptions = {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
  };

  const pty = nodePty.spawn(shell.file, shell.args, ptyOptions);
  const session: TerminalSession = {
    id,
    pid: pty.pid,
    shell: shell.file,
    shellProfile,
    cwd,
    title,
    workspaceKey,
    createdAt: new Date().toISOString(),
    pty,
    ownerId: event.sender.id,
    buffer: "",
  };

  sessions.set(id, session);

  pty.onData((data) => {
    appendSessionBuffer(session, data);
    if (!event.sender.isDestroyed()) {
      event.sender.send("desktop:terminal-data", { id, data });
    }
  });

  pty.onExit(({ exitCode, signal }) => {
    sessions.delete(id);
    if (!event.sender.isDestroyed()) {
      event.sender.send("desktop:terminal-exit", { id, exitCode, signal });
    }
  });

  event.sender.once("destroyed", () => {
    void detachTerminalsForOwner(event.sender.id);
  });

  return toSessionInfo(session);
}

async function createRemoteTerminalSession(event: IpcMainInvokeEvent, options: TerminalCreateOptions, cwd: string, cols: number, rows: number, shellProfile: TerminalShellProfile): Promise<TerminalSessionInfo> {
  const access = getRemoteGatewayAccess(cwd, options.workspaceId);
  if (!access) throw new Error("Remote workspace Gateway is not connected.");
  const url = `${access.baseUrl.replace(/^http/, "ws")}/v1/pty`;
  const socket = new WebSocket(url);
  const workspaceKey = typeof options.workspaceKey === "string" && options.workspaceKey.trim() ? options.workspaceKey : cwd;
  const title = typeof options.title === "string" && options.title.trim() ? options.title.trim().slice(0, 40) : `Terminal ${sessions.size + 1}`;
  return new Promise<TerminalSessionInfo>((resolve, reject) => {
    let session: TerminalSession | undefined;
    const timer = setTimeout(() => { socket.close(); reject(new Error("Remote PTY creation timed out.")); }, 10_000);
    socket.addEventListener("open", () => { socket.send(JSON.stringify({ type: "auth", token: access.token })); socket.send(JSON.stringify({ type: "create", workspaceId: access.workspaceId, cwd, cols, rows })); });
    socket.addEventListener("message", (raw) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(String(raw.data)) as Record<string, unknown>; } catch { return; }
      if (message.type === "created") {
        clearTimeout(timer);
        const id = String(message.id || randomUUID());
        session = { id, pid: Number(message.pid || 0), shell: String(message.shell || "/bin/bash"), shellProfile, cwd: String(message.cwd || cwd), title, workspaceKey, createdAt: new Date().toISOString(), ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}), remoteSocket: socket, ownerId: event.sender.id, buffer: String(message.buffer || "") };
        sessions.set(id, session); resolve(toSessionInfo(session));
      } else if (message.type === "data" && session) {
        const data = String(message.data || ""); appendSessionBuffer(session, data);
        if (!event.sender.isDestroyed()) event.sender.send("desktop:terminal-data", { id: session.id, data });
      } else if (message.type === "exit" && session) {
        sessions.delete(session.id);
        if (!event.sender.isDestroyed()) event.sender.send("desktop:terminal-exit", { id: session.id, exitCode: Number(message.exitCode || 0) });
      } else if (message.type === "error") reject(new Error(String(message.message || "Remote PTY failed.")));
    });
    socket.addEventListener("error", () => { if (!session) { clearTimeout(timer); reject(new Error("Remote PTY connection failed.")); } });
    socket.addEventListener("close", () => { if (session && sessions.has(session.id)) scheduleRemoteTerminalReattach(session, event, 0); });
    event.sender.once("destroyed", () => { void detachTerminalsForOwner(event.sender.id); });
  });
}

function scheduleRemoteTerminalReattach(session: TerminalSession, event: IpcMainInvokeEvent, attempt: number): void {
  if (!sessions.has(session.id) || session.detached) return;
  if (attempt >= 8) {
    sessions.delete(session.id);
    if (!event.sender.isDestroyed()) event.sender.send("desktop:terminal-exit", { id: session.id, exitCode: 255 });
    return;
  }
  setTimeout(() => {
    if (!sessions.has(session.id) || session.detached) return;
    const access = getRemoteGatewayAccess(session.cwd, session.workspaceId);
    if (!access) return scheduleRemoteTerminalReattach(session, event, attempt + 1);
    const socket = new WebSocket(`${access.baseUrl.replace(/^http/, "ws")}/v1/pty`);
    let attached = false;
    socket.addEventListener("open", () => { socket.send(JSON.stringify({ type: "auth", token: access.token })); socket.send(JSON.stringify({ type: "attach", id: session.id })); });
    socket.addEventListener("message", (raw) => {
      let message: Record<string, unknown>; try { message = JSON.parse(String(raw.data)) as Record<string, unknown>; } catch { return; }
      if (message.type === "attached") { attached = true; session.remoteSocket = socket; const data = String(message.buffer || ""); session.buffer = data; if (!event.sender.isDestroyed()) event.sender.send("desktop:terminal-data", { id: session.id, data }); }
      else if (message.type === "data") { const data = String(message.data || ""); appendSessionBuffer(session, data); if (!event.sender.isDestroyed()) event.sender.send("desktop:terminal-data", { id: session.id, data }); }
      else if (message.type === "exit") { sessions.delete(session.id); if (!event.sender.isDestroyed()) event.sender.send("desktop:terminal-exit", { id: session.id, exitCode: Number(message.exitCode || 0) }); }
    });
    socket.addEventListener("close", () => { if (sessions.has(session.id) && !session.detached) scheduleRemoteTerminalReattach(session, event, attached ? 0 : attempt + 1); });
    socket.addEventListener("error", () => socket.close());
  }, Math.min(1000 * 2 ** attempt, 15_000));
}

export async function listTerminalSessions(
  event: IpcMainInvokeEvent,
  workspaceKey?: string,
  workspaceId?: string,
): Promise<TerminalSessionInfo[]> {
  if (workspaceId && ![...sessions.values()].some((session) => session.workspaceId === workspaceId && session.runtimeClient)) {
    const resolved = await connectRuntimeClientForWorkspace(workspaceKey || "", workspaceId);
    const runtimeClient = resolved.client;
    const result = await runtimeClient.executeOWOP(resolved.workspaceId, "pty.list", {});
    for (const value of Array.isArray(result.terminals) ? result.terminals : []) {
      if (!value || typeof value !== "object") continue;
      const terminal = value as Record<string, unknown>;
      if (["exited", "lost"].includes(String(terminal.status))) continue;
      const id = String(terminal.terminal_id);
      const projection = terminalProjections.get(id);
      sessions.set(id, {
        id, pid: Number(terminal.pid ?? 0), shell: String(terminal.shell ?? ""),
        shellProfile: projection?.shellProfile ?? "powershell",
        cwd: String(terminal.cwd ?? workspaceKey ?? ""),
        title: projection?.title ?? `Terminal ${sessions.size + 1}`,
        workspaceKey: projection?.workspaceKey ?? workspaceKey ?? String(terminal.cwd ?? workspaceId),
        workspaceId, createdAt: new Date(Number(terminal.created_at ?? Date.now() / 1000) * 1000).toISOString(),
        ownerId: 0, buffer: "", runtimeClient,
        sequence: projection?.sequence ?? 0,
        generation: projection?.generation ?? Number(terminal.generation ?? 1),
        needsSnapshot: true,
      });
    }
  }
  const matching = [...sessions.values()].filter((session) => !workspaceKey || session.workspaceKey === workspaceKey);
  for (const session of matching) {
    if (session.runtimeClient && session.ownerId === 0) await attachRuntimeSession(session, event);
    else if (session.remoteSocket && session.ownerId === 0) {
      session.ownerId = event.sender.id;
      session.detached = false;
      scheduleRemoteTerminalReattach(session, event, 0);
    }
  }
  return matching.filter((session) => session.ownerId === event.sender.id).map(toSessionInfo);
}

export function getTerminalBuffer(
  event: IpcMainInvokeEvent,
  id: string,
): string {
  const session = sessionForOwner(id, event.sender.id);
  return session?.buffer ?? "";
}

export function renameTerminalSession(
  event: IpcMainInvokeEvent,
  id: string,
  title: string,
): TerminalSessionInfo | null {
  const session = sessionForOwner(id, event.sender.id);
  if (!session || typeof title !== "string" || !title.trim()) return null;
  session.title = title.trim().slice(0, 40);
  saveTerminalProjection(session);
  return toSessionInfo(session);
}

export async function writeTerminalSession(
  event: IpcMainInvokeEvent,
  id: string,
  data: string,
): Promise<boolean> {
  const session = sessionForOwner(id, event.sender.id);
  if (!session || typeof data !== "string") return false;
  if (session.runtimeClient && session.workspaceId && session.leaseId) {
    await session.runtimeClient.executeOWOP(session.workspaceId, "pty.write", {
      pty_id: id, lease_id: session.leaseId, content_base64: Buffer.from(data, "utf8").toString("base64"),
    });
  } else if (session.remoteSocket) session.remoteSocket.send(JSON.stringify({ type: "write", id, data }));
  else session.pty?.write(data);
  return true;
}

export async function resizeTerminalSession(
  event: IpcMainInvokeEvent,
  id: string,
  cols: number,
  rows: number,
): Promise<boolean> {
  const session = sessionForOwner(id, event.sender.id);
  if (!session) return false;
  const nextCols = clampDimension(cols, 100, 20, 500); const nextRows = clampDimension(rows, 30, 5, 200);
  if (session.runtimeClient && session.workspaceId && session.leaseId) {
    await session.runtimeClient.executeOWOP(session.workspaceId, "pty.resize", {
      pty_id: id, lease_id: session.leaseId, cols: nextCols, rows: nextRows,
    });
  } else if (session.remoteSocket) session.remoteSocket.send(JSON.stringify({ type: "resize", id, cols: nextCols, rows: nextRows }));
  else session.pty?.resize(nextCols, nextRows);
  return true;
}

export async function killTerminalSession(
  event: IpcMainInvokeEvent,
  id: string,
): Promise<boolean> {
  const session = sessionForOwner(id, event.sender.id);
  if (!session) return false;
  sessions.delete(id);
  deleteTerminalProjection(id);
  if (session.pollTimer) clearTimeout(session.pollTimer);
  if (session.runtimeClient && session.workspaceId) {
    await session.runtimeClient.executeOWOP(session.workspaceId, "pty.kill", { pty_id: id });
  } else if (session.remoteSocket) requestRemotePtyKill(session.remoteSocket, id);
  else session.pty?.kill();
  return true;
}

function loadTerminalProjections(): TerminalProjection[] {
  try {
    const parsed = JSON.parse(readFileSync(TERMINAL_PROJECTIONS_PATH, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TerminalProjection =>
      item && typeof item.id === "string" && typeof item.workspaceId === "string" &&
      typeof item.workspaceKey === "string" && typeof item.sequence === "number" && typeof item.generation === "number");
  } catch { return []; }
}

function flushTerminalProjections(): void {
  mkdirSync(join(DRSAI_HOME, "desktop"), { recursive: true });
  const temporary = `${TERMINAL_PROJECTIONS_PATH}.tmp`;
  writeFileSync(temporary, JSON.stringify([...terminalProjections.values()], null, 2), "utf8");
  renameSync(temporary, TERMINAL_PROJECTIONS_PATH);
}

function saveTerminalProjection(session: TerminalSession): void {
  if (!session.runtimeClient || !session.workspaceId) return;
  terminalProjections.set(session.id, {
    id: session.id, workspaceId: session.workspaceId, workspaceKey: session.workspaceKey,
    title: session.title, shellProfile: session.shellProfile,
    sequence: session.sequence ?? 0, generation: session.generation ?? 1,
  });
  flushTerminalProjections();
}

function deleteTerminalProjection(id: string): void {
  if (terminalProjections.delete(id)) flushTerminalProjections();
}

function runtimeEvents(result: Record<string, unknown>): Array<{ sequence: number; generation: number; data: string }> {
  const events = Array.isArray(result.events) ? result.events : [];
  return events.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const event = value as Record<string, unknown>;
    if (typeof event.sequence !== "number" || typeof event.generation !== "number" || typeof event.content_base64 !== "string") return [];
    return [{ sequence: event.sequence, generation: event.generation, data: Buffer.from(event.content_base64, "base64").toString("utf8") }];
  });
}

function snapshotAnsi(snapshot: Record<string, unknown>): string {
  const lines = [...(Array.isArray(snapshot.scrollback) ? snapshot.scrollback : []), ...(Array.isArray(snapshot.screen) ? snapshot.screen : [])];
  const encoded = lines.map((line) => Array.isArray(line) ? line.map((value) => {
    const run = value as Record<string, unknown>;
    const style = run.style && typeof run.style === "object" ? run.style as Record<string, unknown> : {};
    const codes: string[] = [];
    if (style.bold) codes.push("1");
    if (style.underline) codes.push("4");
    if (style.inverse) codes.push("7");
    for (const [kind, base] of [["fg", 30], ["bg", 40]] as const) {
      const color = typeof style[kind] === "string" ? style[kind] as string : "";
      if (color.startsWith("ansi:")) {
        const index = Number(color.slice(5));
        codes.push(String(index < 8 ? base + index : base + 60 + index - 8));
      } else if (color.startsWith("index:")) codes.push(`${kind === "fg" ? 38 : 48};5;${color.slice(6)}`);
      else if (color.startsWith("rgb:")) codes.push(`${kind === "fg" ? 38 : 48};2;${color.slice(4).replaceAll(",", ";")}`);
    }
    return `${codes.length ? `\x1b[${codes.join(";")}m` : ""}${String(run.text ?? "")}\x1b[0m`;
  }).join("") : "").join("\r\n");
  const cursor = snapshot.cursor && typeof snapshot.cursor === "object" ? snapshot.cursor as Record<string, unknown> : {};
  return `\x1bc${encoded}\x1b[${Number(cursor.y ?? 0) + 1};${Number(cursor.x ?? 0) + 1}H`;
}

function applyRuntimeEvents(session: TerminalSession, result: Record<string, unknown>): void {
  const snapshot = result.snapshot && typeof result.snapshot === "object" ? result.snapshot as Record<string, unknown> : null;
  const events = runtimeEvents(result);
  const plan = reconcileTerminalReplay(
    { generation: session.generation ?? 1, sequence: session.sequence ?? 0 },
    snapshot ? { generation: Number(snapshot.generation ?? 0), sequence: Number(snapshot.snapshot_sequence ?? 0) } : null,
    events.map((event) => ({ generation: event.generation, sequence: event.sequence, value: event.data })),
  );
  if (snapshot && plan.snapshotAccepted) {
    const data = snapshotAnsi(snapshot);
    session.buffer = data;
    session.needsSnapshot = false;
    if (session.sender && !session.sender.isDestroyed()) session.sender.send("desktop:terminal-data", { id: session.id, data });
  }
  for (const event of plan.accepted) {
    const data = event.value;
    appendSessionBuffer(session, data);
    if (session.sender && !session.sender.isDestroyed()) {
      session.sender.send("desktop:terminal-data", { id: session.id, data });
    }
  }
  session.generation = plan.cursor.generation;
  session.sequence = plan.cursor.sequence;
  session.needsSnapshot = session.needsSnapshot || plan.snapshotRequired;
  saveTerminalProjection(session);
}

function scheduleRuntimePoll(session: TerminalSession): void {
  if (!session.runtimeClient || !session.leaseId || session.pollTimer) return;
  const poll = async (): Promise<void> => {
    session.pollTimer = undefined;
    if (!sessions.has(session.id) || !session.runtimeClient || !session.leaseId || session.ownerId === 0) return;
    try {
      const result = await session.runtimeClient.executeOWOP(session.workspaceId!, "pty.attach", {
        pty_id: session.id,
        lease_id: session.leaseId,
        client_id: `desktop-${session.ownerId}`,
        mode: "writer",
        after_sequence: session.sequence ?? 0,
        lease_seconds: 30,
        prefer_snapshot: Boolean(session.needsSnapshot),
      });
      applyRuntimeEvents(session, result);
      const terminal = result.terminal as Record<string, unknown> | undefined;
      if (terminal?.status === "exited" || terminal?.status === "lost") {
        sessions.delete(session.id);
        deleteTerminalProjection(session.id);
        if (session.sender && !session.sender.isDestroyed()) {
          session.sender.send("desktop:terminal-exit", {
            id: session.id,
            exitCode: Number(terminal.exit_code ?? 255),
            signal: terminal.exit_signal,
          });
        }
        return;
      }
    } catch {
      // A transient Local Runtime failure is retried; lease expiry is surfaced on the next user action.
    }
    if (sessions.has(session.id) && session.ownerId !== 0) session.pollTimer = setTimeout(() => void poll(), 100);
  };
  session.pollTimer = setTimeout(() => void poll(), 0);
}

async function attachRuntimeSession(session: TerminalSession, event: IpcMainInvokeEvent): Promise<void> {
  if (!session.runtimeClient || !session.workspaceId) return;
  const result = await session.runtimeClient.executeOWOP(session.workspaceId, "pty.attach", {
    pty_id: session.id,
    client_id: `desktop-${event.sender.id}`,
    mode: "writer",
    after_sequence: session.sequence ?? 0,
    lease_seconds: 30,
    prefer_snapshot: true,
  });
  session.leaseId = String(result.lease_id);
  session.ownerId = event.sender.id;
  session.sender = event.sender;
  applyRuntimeEvents(session, result);
  scheduleRuntimePoll(session);
}

async function createRuntimeTerminalSession(
  event: IpcMainInvokeEvent,
  options: TerminalCreateOptions,
  cwd: string,
  cols: number,
  rows: number,
  shellProfile: TerminalShellProfile,
  shell: { file: string; args: string[] },
): Promise<TerminalSessionInfo> {
  if (!options.workspaceId) throw new Error("Runtime Terminal requires a Workspace ID.");
  const resolved = await connectRuntimeClientForWorkspace(cwd, options.workspaceId);
  const runtimeClient = resolved.client;
  const created = await runtimeClient.executeOWOP(resolved.workspaceId, "pty.create", {
    argv: [shell.file, ...shell.args], cwd: ".", cols, rows,
  });
  const terminal = created.terminal as Record<string, unknown>;
  const workspaceKey = typeof options.workspaceKey === "string" && options.workspaceKey.trim() ? options.workspaceKey : cwd;
  const session: TerminalSession = {
    id: String(terminal.terminal_id), pid: Number(terminal.pid ?? 0), shell: shell.file,
    shellProfile, cwd: String(terminal.cwd ?? cwd),
    title: typeof options.title === "string" && options.title.trim() ? options.title.trim().slice(0, 40) : `Terminal ${sessions.size + 1}`,
    workspaceKey, workspaceId: resolved.workspaceId,
    createdAt: new Date(Number(terminal.created_at ?? Date.now() / 1000) * 1000).toISOString(),
    ownerId: event.sender.id, sender: event.sender, buffer: "", runtimeClient,
    sequence: Number(terminal.last_sequence ?? 0),
    generation: Number(terminal.generation ?? 1),
  };
  sessions.set(session.id, session);
  await attachRuntimeSession(session, event);
  saveTerminalProjection(session);
  event.sender.once("destroyed", () => { void detachTerminalsForOwner(event.sender.id); });
  return toSessionInfo(session);
}

export async function detachTerminalsForOwner(ownerId: number): Promise<void> {
  for (const [id, session] of sessions) {
    if (session.ownerId === ownerId) {
      if (session.pollTimer) clearTimeout(session.pollTimer);
      session.pollTimer = undefined;
      if (session.runtimeClient && session.workspaceId && session.leaseId) {
        const leaseId = session.leaseId;
        session.leaseId = undefined;
        session.ownerId = 0;
        session.sender = undefined;
        saveTerminalProjection(session);
        try {
          await session.runtimeClient.executeOWOP(session.workspaceId, "pty.detach", { pty_id: id, lease_id: leaseId });
        } catch { /* Runtime lease may already have expired; PTY ownership remains in Runtime. */ }
      } else if (session.remoteSocket) {
        session.ownerId = 0;
        session.detached = true;
        session.remoteSocket.close();
      } else {
        sessions.delete(id);
        if (session.remoteSocket) requestRemotePtyKill(session.remoteSocket, id); else session.pty?.kill();
      }
    }
  }
}

export const killTerminalsForOwner = detachTerminalsForOwner;

export function killAllTerminalSessions(): void {
  for (const [id, session] of sessions) {
    if (session.runtimeClient || session.remoteSocket) {
      void detachTerminalsForOwner(session.ownerId);
    } else {
      sessions.delete(id);
      if (session.remoteSocket) requestRemotePtyKill(session.remoteSocket, id); else session.pty?.kill();
    }
  }
}
