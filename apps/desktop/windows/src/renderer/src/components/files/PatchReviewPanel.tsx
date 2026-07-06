import { Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { WorkspaceGitDiffResult } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";
import { desktopApi } from "../../desktopApi";

type HunkDecision = "pending" | "busy" | "approved" | "rejected" | "error";

export function PatchReviewPanel({
  diff,
  language,
  onReverted,
}: {
  diff: WorkspaceGitDiffResult | null;
  language: AppLanguage;
  onReverted: () => void;
}): React.JSX.Element | null {
  const zh = language === "zh";
  const hunks = useMemo(() => parseDiffHunks(diff?.diff ?? ""), [diff?.diff]);
  const [decisions, setDecisions] = useState<Record<string, HunkDecision>>({});
  const [fileActionState, setFileActionState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [fileActionMessage, setFileActionMessage] = useState<string | null>(null);
  if (!diff || hunks.length === 0) return null;
  const canMutateFile = Boolean(diff.path && diff.diffHash && !diff.staged);

  async function approveFile(): Promise<void> {
    if (!diff?.path || !diff.diffHash || diff.staged) return;
    const confirmed = window.confirm(
      zh
        ? "确认批准该文件当前未暂存修改并加入暂存区？如果文件 diff 已变化，本操作会被拒绝。"
        : "Approve current unstaged changes for this file by staging them? If the diff changed, this action will be refused.",
    );
    if (!confirmed) return;
    setFileActionState("busy");
    setFileActionMessage(null);
    try {
      const result = await desktopApi.stageWorkspaceFile({
        workspacePath: diff.workspacePath,
        path: diff.path,
        expectedDiffHash: diff.diffHash,
      });
      setFileActionState(result.staged ? "done" : "idle");
      setFileActionMessage(result.message);
      onReverted();
    } catch (caught) {
      setFileActionState("error");
      setFileActionMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function revertFile(): Promise<void> {
    if (!diff?.path || !diff.diffHash || diff.staged) return;
    const confirmed = window.confirm(
      zh
        ? "确认撤销该文件当前未暂存修改？如果文件 diff 已变化，本操作会被拒绝。"
        : "Revert current unstaged changes for this file? If the diff changed, this action will be refused.",
    );
    if (!confirmed) return;
    setFileActionState("busy");
    setFileActionMessage(null);
    try {
      const result = await desktopApi.revertWorkspaceFile({
        workspacePath: diff.workspacePath,
        path: diff.path,
        expectedDiffHash: diff.diffHash,
      });
      setFileActionState(result.reverted ? "done" : "idle");
      setFileActionMessage(result.message);
      onReverted();
    } catch (caught) {
      setFileActionState("error");
      setFileActionMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function applyHunk(
    hunk: DiffHunk,
    action: "approve" | "reject",
  ): Promise<void> {
    if (!diff?.path || !diff.diffHash || diff.staged) return;
    const confirmed = window.confirm(
      action === "approve"
        ? zh
          ? "确认批准并暂存这个 hunk？如果文件 diff 已变化，本操作会被拒绝。"
          : "Approve and stage this hunk? If the diff changed, this action will be refused."
        : zh
          ? "确认拒绝并从工作区撤销这个 hunk？如果文件 diff 已变化，本操作会被拒绝。"
          : "Reject and revert this hunk from the worktree? If the diff changed, this action will be refused.",
    );
    if (!confirmed) return;
    setDecisions((current) => ({ ...current, [hunk.id]: "busy" }));
    setFileActionState("busy");
    setFileActionMessage(null);
    try {
      const request = {
        workspacePath: diff.workspacePath,
        path: diff.path,
        expectedDiffHash: diff.diffHash,
        patch: hunk.patch,
      };
      const result = action === "approve"
        ? await desktopApi.stageWorkspaceHunk(request)
        : await desktopApi.revertWorkspaceHunk(request);
      setDecisions((current) => ({
        ...current,
        [hunk.id]: result.applied ? (action === "approve" ? "approved" : "rejected") : "error",
      }));
      setFileActionState(result.applied ? "done" : "error");
      setFileActionMessage(result.message);
      if (result.applied) onReverted();
    } catch (caught) {
      setDecisions((current) => ({ ...current, [hunk.id]: "error" }));
      setFileActionMessage(caught instanceof Error ? caught.message : String(caught));
      setFileActionState("error");
    }
  }

  return (
    <section className="files-patch-review" aria-label="Patch review">
      <div className="files-patch-review-title">
        <span>{zh ? "Patch 审阅" : "Patch Review"}</span>
        <small>{hunks.length} hunks · review only</small>
      </div>
      <div className="files-patch-review-actions">
        <button
          type="button"
          disabled={!canMutateFile || fileActionState === "busy"}
          onClick={() => void approveFile()}
        >
          {zh ? "批准并暂存文件" : "Approve and stage file"}
        </button>
        <button
          type="button"
          disabled={!canMutateFile || fileActionState === "busy"}
          onClick={() => void revertFile()}
        >
          {zh ? "安全撤销文件修改" : "Safe revert file"}
        </button>
        {fileActionMessage ? <span className={fileActionState}>{fileActionMessage}</span> : null}
      </div>
      <div className="files-patch-hunks">
        {hunks.slice(0, 12).map((hunk) => {
          const decision = decisions[hunk.id] ?? "pending";
          return (
            <article className={`files-patch-hunk ${decision}`} key={hunk.id}>
              <header>
                <strong>{hunk.header}</strong>
                <span>{decision}</span>
              </header>
              <pre>{hunk.body}</pre>
              <div>
                <button
                  type="button"
                  disabled={decision === "busy" || !canMutateFile}
                  onClick={() => void applyHunk(hunk, "approve")}
                >
                  <Check size={13} />
                  {zh ? "通过" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={decision === "busy" || !canMutateFile}
                  onClick={() => void applyHunk(hunk, "reject")}
                >
                  <X size={13} />
                  {zh ? "拒绝" : "Reject"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

interface DiffHunk {
  body: string;
  header: string;
  id: string;
  patch: string;
}

function parseDiffHunks(diff: string): DiffHunk[] {
  const lines = diff.split(/\r?\n/);
  const hunks: DiffHunk[] = [];
  const fileHeader: string[] = [];
  let current: { id: string; header: string; body: string[] } | null = null;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (current) {
        hunks.push(toDiffHunk(current, fileHeader));
      }
      current = {
        id: `hunk-${hunks.length}-${line}`,
        header: line,
        body: [],
      };
      continue;
    }
    if (!current && line.trim()) {
      fileHeader.push(line);
      continue;
    }
    current?.body.push(line);
  }
  if (current) hunks.push(toDiffHunk(current, fileHeader));
  return hunks;
}

function toDiffHunk(
  hunk: { id: string; header: string; body: string[] },
  fileHeader: string[],
): DiffHunk {
  const body = hunk.body.join("\n");
  return {
    ...hunk,
    body,
    patch: [...fileHeader, hunk.header, body].filter(Boolean).join("\n") + "\n",
  };
}
