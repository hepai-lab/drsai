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
  workspaceKey?: string;
  title?: string;
  shellProfile?: TerminalShellProfile;
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
}

interface TerminalSession extends TerminalSessionInfo {
  pty: IPty;
  ownerId: number;
  buffer: string;
}

const sessions = new Map<string, TerminalSession>();
const MAX_BUFFER_LENGTH = 200_000;

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
          "Set-PSReadLineOption -HistorySaveStyle SaveNothing",
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
        "Set-PSReadLineOption -HistorySaveStyle SaveNothing",
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
  };
}

export function createTerminalSession(
  event: IpcMainInvokeEvent,
  options: TerminalCreateOptions = {},
): TerminalSessionInfo {
  const nodePty = loadNodePty();
  const shellProfile = normalizeShellProfile(options.shellProfile);
  const shell = resolveShell(shellProfile);
  const cwd =
    typeof options.cwd === "string" &&
    options.cwd.trim() &&
    existsSync(options.cwd)
      ? options.cwd
      : homedir();
  const cols = clampDimension(options.cols, 100, 20, 500);
  const rows = clampDimension(options.rows, 30, 5, 200);
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
    killTerminalsForOwner(event.sender.id);
  });

  return toSessionInfo(session);
}

export function listTerminalSessions(
  event: IpcMainInvokeEvent,
  workspaceKey?: string,
): TerminalSessionInfo[] {
  return [...sessions.values()]
    .filter((session) => session.ownerId === event.sender.id)
    .filter((session) => !workspaceKey || session.workspaceKey === workspaceKey)
    .map(toSessionInfo);
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
  return toSessionInfo(session);
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
