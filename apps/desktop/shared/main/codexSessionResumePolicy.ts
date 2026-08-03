export interface CodexSessionResumeThread {
  id: string;
  archiveSource?: string | null;
  lastRunId?: string | null;
}

export function requiresCodexSessionResume(
  thread: CodexSessionResumeThread | undefined,
  agentDefinition: string,
): boolean {
  return Boolean(
    thread
    && agentDefinition === "codex@1"
    && (
      thread.id.startsWith("session-codex-")
      || thread.archiveSource === "codex"
      || thread.lastRunId
    )
  );
}
