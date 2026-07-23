import type { IpcMainInvokeEvent, WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { IPty, IPtyForkOptions } from "node-pty";
import type { TerminalCreateOptions, TerminalSessionInfo, TerminalShellProfile } from "../../../shared/api/desktopApi";

interface TerminalSession extends TerminalSessionInfo {
  ownerId: number;
  sender?: WebContents;
  pty: IPty;
  buffer: string;
  terminating: boolean;
  exitPromise: Promise<void>;
  resolveExit: () => void;
}

const sessions = new Map<string, TerminalSession>();
const MAX_BUFFER = 200_000;
const TERMINATE_GRACE_MS = 1_500;
type PtyFactory = (file: string, args: string[] | string, options: IPtyForkOptions) => IPty;
const loadDefaultPtyFactory = (): PtyFactory => {
  const require = createRequire(import.meta.url);
  return (require("node-pty") as { spawn: PtyFactory }).spawn;
};
let ptyFactory: PtyFactory | undefined;
type RemoteTerminalResolver = (options: TerminalCreateOptions) => { file: string; args: string[]; cwd: string };
let remoteTerminalResolver: RemoteTerminalResolver | undefined;

export function configureMacosTerminalPtyFactory(factory?: PtyFactory): void { ptyFactory = factory; }
export function configureMacosRemoteTerminalResolver(resolver?: RemoteTerminalResolver): void { remoteTerminalResolver = resolver; }

export function createTerminalSession(event: IpcMainInvokeEvent, options: TerminalCreateOptions = {}): TerminalSessionInfo {
  const remote = options.remoteHostAlias ? remoteTerminalResolver?.(options) : undefined;
  if (options.remoteHostAlias && !remote) throw new Error("Remote terminal routing is unavailable.");
  const shellProfile: TerminalShellProfile = remote ? "zsh" : options.shellProfile === "bash" ? "bash" : "zsh";
  const shell = remote?.file ?? (shellProfile === "bash" ? "/bin/bash" : "/bin/zsh");
  const cwd = remote?.cwd ?? resolve(options.cwd || homedir());
  const pty = (ptyFactory ?? loadDefaultPtyFactory())(shell, remote?.args ?? ["-l"], {
    name: "xterm-256color",
    cols: dimension(options.cols, 100, 20, 400),
    rows: dimension(options.rows, 30, 5, 200),
    cwd: remote ? homedir() : cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  });
  let resolveExit: () => void = () => {};
  const exitPromise = new Promise<void>((resolvePromise) => { resolveExit = resolvePromise; });
  const session: TerminalSession = {
    id: randomUUID(), pid: pty.pid, shell, shellProfile, cwd,
    title: options.title?.trim().slice(0, 120) || shellProfile,
    workspaceKey: options.workspaceKey?.trim() || cwd,
    workspaceId: options.workspaceId,
    createdAt: new Date().toISOString(), ownerId: event.sender.id, sender: event.sender, pty, buffer: "", terminating: false, exitPromise, resolveExit,
  };
  sessions.set(session.id, session);
  pty.onData((data) => {
    session.buffer = `${session.buffer}${data}`.slice(-MAX_BUFFER);
    if (session.sender && !session.sender.isDestroyed()) session.sender.send("desktop:terminal-data", { id: session.id, data });
  });
  pty.onExit(({ exitCode, signal }) => {
    sessions.delete(session.id);
    session.resolveExit();
    if (session.sender && !session.sender.isDestroyed()) session.sender.send("desktop:terminal-exit", { id: session.id, exitCode, signal });
  });
  return publicInfo(session);
}

export function listTerminalSessions(event: IpcMainInvokeEvent, workspaceKey?: string, workspaceId?: string): TerminalSessionInfo[] {
  const hasScope = Boolean(workspaceKey || workspaceId);
  return [...sessions.values()].filter((session) => {
    const matches = (!workspaceKey || session.workspaceKey === workspaceKey) && (!workspaceId || session.workspaceId === workspaceId);
    if (!matches) return false;
    if (session.ownerId === 0 && hasScope) { session.ownerId = event.sender.id; session.sender = event.sender; }
    return session.ownerId === event.sender.id;
  }).map(publicInfo);
}

export function getTerminalBuffer(event: IpcMainInvokeEvent, id: string): string {
  return owned(event, id)?.buffer ?? "";
}

export function renameTerminalSession(event: IpcMainInvokeEvent, id: string, title: string): TerminalSessionInfo | null {
  const session = owned(event, id);
  if (!session || typeof title !== "string") return null;
  session.title = title.trim().slice(0, 120) || session.shellProfile;
  return publicInfo(session);
}

export function writeTerminalSession(event: IpcMainInvokeEvent, id: string, data: string): boolean {
  const session = owned(event, id);
  if (!session || session.terminating || typeof data !== "string" || Buffer.byteLength(data, "utf8") > 100_000) return false;
  session.pty.write(data);
  return true;
}

export function resizeTerminalSession(event: IpcMainInvokeEvent, id: string, cols: number, rows: number): boolean {
  const session = owned(event, id);
  if (!session || session.terminating) return false;
  session.pty.resize(dimension(cols, 100, 20, 400), dimension(rows, 30, 5, 200));
  return true;
}

export function killTerminalSession(event: IpcMainInvokeEvent, id: string): boolean {
  const session = owned(event, id);
  if (!session || session.terminating) return false;
  void terminateSession(session);
  return true;
}

export function detachTerminalSessionsForOwner(ownerId: number): void {
  for (const session of [...sessions.values()]) {
    if (session.ownerId !== ownerId) continue;
    session.ownerId = 0;
    session.sender = undefined;
  }
}
export const killTerminalSessionsForOwner = detachTerminalSessionsForOwner;

export async function killAllTerminalSessions(): Promise<void> {
  await Promise.allSettled([...sessions.values()].map(terminateSession));
  sessions.clear();
}

function owned(event: IpcMainInvokeEvent, id: string): TerminalSession | null {
  if (typeof id !== "string" || id.length > 160) return null;
  const session = sessions.get(id);
  if (!session || session.ownerId !== event.sender.id) return null;
  return session;
}

function publicInfo(session: TerminalSession): TerminalSessionInfo {
  const { ownerId: _ownerId, sender: _sender, pty: _pty, buffer: _buffer, terminating: _terminating, exitPromise: _exitPromise, resolveExit: _resolveExit, ...info } = session;
  return info;
}

async function terminateSession(session: TerminalSession): Promise<void> {
  if (session.terminating) return session.exitPromise;
  session.terminating = true;
  signalProcessGroup(session.pid, "SIGTERM");
  try { session.pty.kill(); } catch { session.resolveExit(); }
  await Promise.race([session.exitPromise, delay(TERMINATE_GRACE_MS)]);
  if (sessions.has(session.id)) {
    signalProcessGroup(session.pid, "SIGKILL");
    try { session.pty.kill("SIGKILL"); } catch { /* already exited */ }
    sessions.delete(session.id);
    session.resolveExit();
  }
}
function signalProcessGroup(pid: number, signal: NodeJS.Signals): void { if (!Number.isInteger(pid) || pid <= 0) return; try { process.kill(-Math.abs(pid), signal); } catch { /* process group may already be gone */ } }
function delay(ms: number): Promise<void> { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }

function dimension(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}
