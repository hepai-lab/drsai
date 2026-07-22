import type { IpcMainInvokeEvent } from "electron";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { homedir } from "os";
import { delimiter, join } from "path";

type IPty = import("node-pty").IPty;
type IPtyForkOptions = import("node-pty").IPtyForkOptions;
type NodePty = typeof import("node-pty");

export interface TerminalCreateOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
}

export interface TerminalSessionInfo {
  id: string;
  pid: number;
  shell: string;
  cwd: string;
}

interface TerminalSession extends TerminalSessionInfo {
  pty: IPty;
  ownerId: number;
}

const sessions = new Map<string, TerminalSession>();

function clampDimension(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function resolvePowerShellExe(): string {
  const programFiles = process.env.ProgramFiles;
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const candidates = [
    programFiles ? join(programFiles, "PowerShell", "7", "pwsh.exe") : null,
    findOnPath("pwsh.exe"),
    join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    findOnPath("powershell.exe"),
    "pwsh.exe",
    "powershell.exe",
  ].filter(Boolean) as string[];

  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    candidates[candidates.length - 1]
  );
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

function resolveShell(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return { file: resolvePowerShellExe(), args: ["-NoLogo"] };
  }

  return { file: process.env.SHELL || "/bin/bash", args: [] };
}

function loadNodePty(): NodePty {
  // node-pty is a native Electron dependency, so load it only when a terminal is requested.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node-pty") as NodePty;
}

function sessionForOwner(id: string, ownerId: number): TerminalSession | null {
  const session = sessions.get(id);
  if (!session || session.ownerId !== ownerId) return null;
  return session;
}

export function createTerminalSession(
  event: IpcMainInvokeEvent,
  options: TerminalCreateOptions = {},
): TerminalSessionInfo {
  const nodePty = loadNodePty();
  const shell = resolveShell();
  const cwd =
    typeof options.cwd === "string" && options.cwd.trim()
      ? options.cwd
      : homedir();
  const cols = clampDimension(options.cols, 100, 20, 500);
  const rows = clampDimension(options.rows, 30, 5, 200);
  const id = randomUUID();

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
    cwd,
    pty,
    ownerId: event.sender.id,
  };

  sessions.set(id, session);

  pty.onData((data) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("terminal-data", { id, data });
    }
  });

  pty.onExit(({ exitCode, signal }) => {
    sessions.delete(id);
    if (!event.sender.isDestroyed()) {
      event.sender.send("terminal-exit", { id, exitCode, signal });
    }
  });

  event.sender.once("destroyed", () => {
    killTerminalsForOwner(event.sender.id);
  });

  return {
    id: session.id,
    pid: session.pid,
    shell: session.shell,
    cwd: session.cwd,
  };
}

export function writeTerminalSession(
  event: IpcMainInvokeEvent,
  id: string,
  data: string,
): boolean {
  const session = sessionForOwner(id, event.sender.id);
  if (!session || typeof data !== "string") return false;
  session.pty.write(data);
  return true;
}

export function resizeTerminalSession(
  event: IpcMainInvokeEvent,
  id: string,
  cols: number,
  rows: number,
): boolean {
  const session = sessionForOwner(id, event.sender.id);
  if (!session) return false;
  session.pty.resize(
    clampDimension(cols, 100, 20, 500),
    clampDimension(rows, 30, 5, 200),
  );
  return true;
}

export function killTerminalSession(
  event: IpcMainInvokeEvent,
  id: string,
): boolean {
  const session = sessionForOwner(id, event.sender.id);
  if (!session) return false;
  sessions.delete(id);
  session.pty.kill();
  return true;
}

export function killTerminalsForOwner(ownerId: number): void {
  for (const [id, session] of sessions) {
    if (session.ownerId === ownerId) {
      sessions.delete(id);
      session.pty.kill();
    }
  }
}

export function killAllTerminalSessions(): void {
  for (const [id, session] of sessions) {
    sessions.delete(id);
    session.pty.kill();
  }
}
