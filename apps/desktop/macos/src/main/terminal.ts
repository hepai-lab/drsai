import type { IpcMainInvokeEvent, WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawn, type IPty } from "node-pty";
import type { TerminalCreateOptions, TerminalSessionInfo, TerminalShellProfile } from "../../../shared/api/desktopApi";

interface TerminalSession extends TerminalSessionInfo {
  ownerId: number;
  sender: WebContents;
  pty: IPty;
  buffer: string;
}

const sessions = new Map<string, TerminalSession>();
const MAX_BUFFER = 200_000;

export function createTerminalSession(event: IpcMainInvokeEvent, options: TerminalCreateOptions = {}): TerminalSessionInfo {
  const shellProfile: TerminalShellProfile = options.shellProfile === "bash" ? "bash" : "zsh";
  const shell = shellProfile === "bash" ? "/bin/bash" : "/bin/zsh";
  const cwd = resolve(options.cwd || homedir());
  const pty = spawn(shell, ["-l"], {
    name: "xterm-256color",
    cols: dimension(options.cols, 100, 20, 400),
    rows: dimension(options.rows, 30, 5, 200),
    cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  });
  const session: TerminalSession = {
    id: randomUUID(), pid: pty.pid, shell, shellProfile, cwd,
    title: options.title?.trim().slice(0, 120) || shellProfile,
    workspaceKey: options.workspaceKey?.trim() || cwd,
    workspaceId: options.workspaceId,
    createdAt: new Date().toISOString(), ownerId: event.sender.id, sender: event.sender, pty, buffer: "",
  };
  sessions.set(session.id, session);
  pty.onData((data) => {
    session.buffer = `${session.buffer}${data}`.slice(-MAX_BUFFER);
    if (!session.sender.isDestroyed()) session.sender.send("desktop:terminal-data", { id: session.id, data });
  });
  pty.onExit(({ exitCode, signal }) => {
    sessions.delete(session.id);
    if (!session.sender.isDestroyed()) session.sender.send("desktop:terminal-exit", { id: session.id, exitCode, signal });
  });
  return publicInfo(session);
}

export function listTerminalSessions(event: IpcMainInvokeEvent, workspaceKey?: string, workspaceId?: string): TerminalSessionInfo[] {
  return [...sessions.values()].filter((session) => session.ownerId === event.sender.id && (!workspaceKey || session.workspaceKey === workspaceKey) && (!workspaceId || session.workspaceId === workspaceId)).map(publicInfo);
}

export function getTerminalBuffer(event: IpcMainInvokeEvent, id: string): string {
  return owned(event, id).buffer;
}

export function renameTerminalSession(event: IpcMainInvokeEvent, id: string, title: string): TerminalSessionInfo {
  const session = owned(event, id);
  session.title = title.trim().slice(0, 120) || session.shellProfile;
  return publicInfo(session);
}

export function writeTerminalSession(event: IpcMainInvokeEvent, id: string, data: string): boolean {
  if (typeof data !== "string" || data.length > 100_000) return false;
  owned(event, id).pty.write(data);
  return true;
}

export function resizeTerminalSession(event: IpcMainInvokeEvent, id: string, cols: number, rows: number): boolean {
  owned(event, id).pty.resize(dimension(cols, 100, 20, 400), dimension(rows, 30, 5, 200));
  return true;
}

export function killTerminalSession(event: IpcMainInvokeEvent, id: string): boolean {
  const session = owned(event, id);
  sessions.delete(id);
  session.pty.kill();
  return true;
}

export function killTerminalSessionsForOwner(ownerId: number): void {
  for (const session of [...sessions.values()]) {
    if (session.ownerId !== ownerId) continue;
    sessions.delete(session.id);
    session.pty.kill();
  }
}

export function killAllTerminalSessions(): void {
  for (const session of [...sessions.values()]) session.pty.kill();
  sessions.clear();
}

function owned(event: IpcMainInvokeEvent, id: string): TerminalSession {
  const session = sessions.get(id);
  if (!session || session.ownerId !== event.sender.id) throw new Error("Terminal session was not found for this window.");
  return session;
}

function publicInfo(session: TerminalSession): TerminalSessionInfo {
  const { ownerId: _ownerId, sender: _sender, pty: _pty, buffer: _buffer, ...info } = session;
  return info;
}

function dimension(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}
