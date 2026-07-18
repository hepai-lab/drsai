import { Camera, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type {
  ChatAttachment,
  WorkspaceGitDiffResult,
  WorkspaceInstructionSummary,
} from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";

export interface ContextSnapshot {
  attachments: Array<{
    hash: string;
    kind: ChatAttachment["kind"];
    name: string;
    path: string;
  }>;
  createdAt: string;
  diffHash: string | null;
  diffPath: string | null;
  id: string;
  instructionHashes: Array<{
    hash: string;
    path: string;
  }>;
  scopeId: string;
}

export function ContextSnapshotPanel({
  currentAttachments,
  language,
  snapshots,
}: {
  currentAttachments: ChatAttachment[];
  language: AppLanguage;
  snapshots: ContextSnapshot[];
}): React.JSX.Element {
  const zh = language === "zh";
  const [expandedId, setExpandedId] = useState<string | null>(snapshots[0]?.id ?? null);
  const currentHashes = new Map(
    currentAttachments.map((attachment) => [
      `${attachment.path}\n${attachment.name}`,
      hashAttachment(attachment),
    ]),
  );

  return (
    <section className="files-context-snapshots" aria-label="Context snapshots">
      <div className="files-context-snapshots-title">
        <Camera size={13} />
        <span>{zh ? "上下文快照" : "Context Snapshots"}</span>
        <small>{snapshots.length} snapshots</small>
      </div>
      {snapshots.length === 0 ? (
        <p>
          {zh
            ? "加入文件、目录、指令或 diff 后，会在这里记录发送给 Agent 的精确上下文集合。"
            : "Attaching files, folders, instructions, or diffs records the exact context set here."}
        </p>
      ) : (
        <ol>
          {snapshots.slice(0, 8).map((snapshot) => {
            const expanded = expandedId === snapshot.id;
            const staleCount = snapshot.attachments.filter((attachment) => {
              const current = currentHashes.get(`${attachment.path}\n${attachment.name}`);
              return current !== undefined && current !== attachment.hash;
            }).length;
            return (
              <li className={staleCount > 0 ? "stale" : ""} key={snapshot.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : snapshot.id)}
                >
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <strong>{snapshot.id}</strong>
                  <span>{snapshot.attachments.length} items</span>
                  {staleCount > 0 ? <em>{staleCount} stale</em> : null}
                </button>
                {expanded ? (
                  <div className="files-context-snapshot-detail">
                    <small>
                      {new Date(snapshot.createdAt).toLocaleString()} · {snapshot.scopeId}
                    </small>
                    <small>
                      instructions {snapshot.instructionHashes.length}
                      {snapshot.diffHash ? ` · diff ${snapshot.diffPath ?? "workspace"}` : ""}
                    </small>
                    <ul>
                      {snapshot.attachments.map((attachment) => (
                        <li key={`${snapshot.id}-${attachment.path}-${attachment.name}`}>
                          <span>{attachment.name}</span>
                          <code>{attachment.hash}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function createContextSnapshot({
  attachments,
  diff,
  instructions,
  scopeId,
}: {
  attachments: ChatAttachment[];
  diff: WorkspaceGitDiffResult | null;
  instructions: WorkspaceInstructionSummary[];
  scopeId: string;
}): ContextSnapshot {
  const createdAt = new Date().toISOString();
  return {
    attachments: attachments.map((attachment) => ({
      hash: hashAttachment(attachment),
      kind: attachment.kind,
      name: attachment.name,
      path: attachment.path,
    })),
    createdAt,
    diffHash: diff ? hashString(diff.diff) : null,
    diffPath: diff?.path ?? null,
    id: `snap-${Date.now().toString(36)}`,
    instructionHashes: instructions.map((instruction) => ({
      hash: hashString(instruction.content),
      path: instruction.path,
    })),
    scopeId,
  };
}

function hashAttachment(attachment: ChatAttachment): string {
  if (attachment.fileHash) return attachment.fileHash;
  return hashString(
    [
      attachment.kind,
      attachment.path,
      attachment.name,
      attachment.visibleText ?? "",
      attachment.note ?? "",
    ].join("\n"),
  );
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
