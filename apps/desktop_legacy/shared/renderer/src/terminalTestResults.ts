export type TerminalTestResultStatus = "passed" | "failed" | "stopped";

export interface RecentTerminalTestResult {
  command: string;
  completedAt: string;
  exitCode?: number;
  source: "terminal";
  status: TerminalTestResultStatus;
  workspaceKey: string;
}

interface TerminalRunSnapshot {
  command?: string;
  completedAt?: string;
  exitCode?: number;
  status?: string;
}

const TERMINAL_TEST_RESULT_PREFIX = "opendrsai.terminal.recentTestResult.";

export function recordRecentTerminalTestResult(
  workspaceKey: string,
  run: TerminalRunSnapshot,
): boolean {
  const command = run.command?.trim();
  if (!command || !isVerificationCommand(command)) return false;
  if (!isCompletedTerminalRun(run)) return false;

  const result: RecentTerminalTestResult = {
    command,
    completedAt: run.completedAt || new Date().toISOString(),
    source: "terminal",
    status: terminalRunStatusToTestStatus(run.status),
    workspaceKey,
    ...(typeof run.exitCode === "number" ? { exitCode: run.exitCode } : {}),
  };
  window.localStorage.setItem(
    recentTerminalTestResultKey(workspaceKey),
    JSON.stringify(result),
  );
  return true;
}

export function readRecentTerminalTestResult(
  workspaceKey: string,
): RecentTerminalTestResult | null {
  try {
    const raw = window.localStorage.getItem(recentTerminalTestResultKey(workspaceKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RecentTerminalTestResult>;
    if (
      parsed.source !== "terminal" ||
      typeof parsed.command !== "string" ||
      typeof parsed.completedAt !== "string" ||
      !isTerminalTestResultStatus(parsed.status)
    ) {
      return null;
    }
    return {
      command: parsed.command,
      completedAt: parsed.completedAt,
      source: "terminal",
      status: parsed.status,
      workspaceKey: typeof parsed.workspaceKey === "string" ? parsed.workspaceKey : workspaceKey,
      ...(typeof parsed.exitCode === "number" ? { exitCode: parsed.exitCode } : {}),
    };
  } catch {
    return null;
  }
}

export function formatRecentTerminalTestResult(
  result: RecentTerminalTestResult | null,
): string {
  if (!result) return "No terminal test run captured for this workspace.";
  const exit = typeof result.exitCode === "number" ? `, exit ${result.exitCode}` : "";
  return `${testStatusLabel(result.status)}${exit}: ${result.command} at ${result.completedAt}`;
}

function recentTerminalTestResultKey(workspaceKey: string): string {
  return `${TERMINAL_TEST_RESULT_PREFIX}${workspaceKey}`;
}

function isCompletedTerminalRun(run: TerminalRunSnapshot): boolean {
  if (run.status === "stopped") return true;
  return (
    (run.status === "succeeded" || run.status === "failed") &&
    typeof run.exitCode === "number"
  );
}

function terminalRunStatusToTestStatus(status: string | undefined): TerminalTestResultStatus {
  if (status === "succeeded") return "passed";
  if (status === "stopped") return "stopped";
  return "failed";
}

function isTerminalTestResultStatus(
  status: unknown,
): status is TerminalTestResultStatus {
  return status === "passed" || status === "failed" || status === "stopped";
}

function testStatusLabel(status: TerminalTestResultStatus): string {
  if (status === "passed") return "Passed";
  if (status === "stopped") return "Stopped";
  return "Failed";
}

function isVerificationCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return [
    /\bnpm\s+(test|t)\b/,
    /\bnpm\s+run\s+(test|verify|typecheck|build)(:[\w-]+)?\b/,
    /\b(pnpm|yarn)\s+(test|typecheck|build)\b/,
    /\b(pnpm|yarn)\s+run\s+(test|verify|typecheck|build)(:[\w-]+)?\b/,
    /\bnode\s+scripts[\\/]+verify[-\w.]*\.mjs\b/,
    /\bpytest\b/,
    /\bpython\s+-m\s+(pytest|unittest)\b/,
    /\b(vitest|jest)\b/,
    /\bplaywright\s+test\b/,
    /\bcargo\s+test\b/,
    /\bgo\s+test\b/,
    /\bdotnet\s+test\b/,
    /\bgradle\s+test\b/,
    /\bmvn\s+test\b/,
    /\btsc\s+--noemit\b/,
  ].some((pattern) => pattern.test(normalized));
}
