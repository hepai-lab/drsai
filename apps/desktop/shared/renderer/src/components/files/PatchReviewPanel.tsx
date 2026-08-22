import { Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { WorkspaceGitDiffResult } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";
import { desktopApi } from "../../desktopApi";
import { requestAppDecision } from "../AppDecisionDialog";
import { userFacingFailureMessage } from "../../userFacingLanguage";

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
    const confirmed = await requestAppDecision({ id: "stage-current-file", title: zh ? "批准并暂存文件修改？" : "Approve and stage file changes?", description: diff.path, impact: zh ? "当前未暂存修改会加入暂存区；如果内容已变化，操作会安全拒绝。" : "Current unstaged changes will be staged. The action safely stops if content changed.", confirmLabel: zh ? "批准并暂存" : "Approve and stage" });
    if (!confirmed) return;
    setFileActionState("busy");
    setFileActionMessage(null);
    try {
      const result = await desktopApi.stageWorkspaceFile({
        workspacePath: diff.workspacePath,
        path: diff.path,
        expectedDiffHash: diff.diffHash,
      });
      setFileActionState(result.approvalQueued ? "busy" : result.staged ? "done" : "idle");
      setFileActionMessage(result.message);
      if (result.staged) onReverted();
    } catch (caught) {
      setFileActionState("error");
      setFileActionMessage(userFacingFailureMessage(caught, language, "operation"));
    }
  }

  async function revertFile(): Promise<void> {
    if (!diff?.path || !diff.diffHash || diff.staged) return;
    const confirmed = await requestAppDecision({ id: "revert-current-file", tone: "danger", title: zh ? "撤销文件修改？" : "Revert file changes?", description: diff.path, impact: zh ? "当前未暂存修改会被移除；如果内容已变化，操作会安全拒绝。" : "Current unstaged changes will be removed. The action safely stops if content changed.", confirmLabel: zh ? "撤销修改" : "Revert changes" });
    if (!confirmed) return;
    setFileActionState("busy");
    setFileActionMessage(null);
    try {
      const result = await desktopApi.revertWorkspaceFile({
        workspacePath: diff.workspacePath,
        path: diff.path,
        expectedDiffHash: diff.diffHash,
      });
      setFileActionState(result.approvalQueued ? "busy" : result.reverted ? "done" : "idle");
      setFileActionMessage(result.message);
      if (result.reverted) onReverted();
    } catch (caught) {
      setFileActionState("error");
      setFileActionMessage(userFacingFailureMessage(caught, language, "operation"));
    }
  }

  async function applyHunk(
    hunk: DiffHunk,
    action: "approve" | "reject",
  ): Promise<void> {
    if (!diff?.path || !diff.diffHash || diff.staged) return;
    const confirmed = await requestAppDecision({ id: `review-file-section-${action}`, tone: action === "reject" ? "danger" : "normal", title: action === "approve" ? (zh ? "批准这段修改？" : "Approve this section?") : (zh ? "撤销这段修改？" : "Revert this section?"), description: diff.path, impact: action === "approve" ? (zh ? "这段修改会加入暂存区；内容变化时会安全拒绝。" : "This section will be staged; changed content is safely rejected.") : (zh ? "这段未暂存修改会从工作区移除；内容变化时会安全拒绝。" : "This unstaged section will be removed; changed content is safely rejected."), confirmLabel: action === "approve" ? (zh ? "批准并暂存" : "Approve and stage") : (zh ? "撤销这段修改" : "Revert section") });
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
        [hunk.id]: result.approvalQueued
          ? "busy"
          : result.applied
            ? (action === "approve" ? "approved" : "rejected")
            : "error",
      }));
      setFileActionState(result.approvalQueued ? "busy" : result.applied ? "done" : "error");
      setFileActionMessage(result.message);
      if (result.applied) onReverted();
    } catch (caught) {
      setDecisions((current) => ({ ...current, [hunk.id]: "error" }));
      setFileActionMessage(userFacingFailureMessage(caught, language, "operation"));
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
