import { ArrowDown, ArrowUp, FileText, Trash2, X } from "lucide-react";
import type { ChatAttachment } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";

export function ContextBasket({
  attachments,
  language,
  onChange,
}: {
  attachments: ChatAttachment[];
  language: AppLanguage;
  onChange: (attachments: ChatAttachment[]) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  return (
    <footer className="files-context-basket" aria-label="Files context basket">
      <div className="files-basket-title">
        <span>{zh ? "智能体使用的材料" : "Agent Context"}</span>
        <small>{attachments.length} items · {estimateContextSize(attachments)}</small>
      </div>
      <div className="files-basket-items">
        {attachments.length === 0 ? (
          <p>{zh ? "尚未选择要交给智能体的文件。" : "No files selected for the agent yet."}</p>
        ) : (
          attachments.map((attachment, index) => (
            <span
              className="files-basket-chip"
              key={`${attachment.path}-${index}`}
              title={attachment.path}
            >
              <FileText size={13} />
              <span>{attachment.name}</span>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => onChange(moveAttachment(attachments, index, index - 1))}
                aria-label={`Move ${attachment.name} up`}
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                disabled={index >= attachments.length - 1}
                onClick={() => onChange(moveAttachment(attachments, index, index + 1))}
                aria-label={`Move ${attachment.name} down`}
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange(attachments.filter((_item, itemIndex) => itemIndex !== index))
                }
                aria-label={`Remove ${attachment.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))
        )}
      </div>
      {attachments.length > 0 ? (
        <button
          type="button"
          className="files-basket-clear"
          onClick={() => onChange([])}
        >
          <Trash2 size={13} />
          {zh ? "清空" : "Clear"}
        </button>
      ) : null}
    </footer>
  );
}

function moveAttachment(
  attachments: ChatAttachment[],
  from: number,
  to: number,
): ChatAttachment[] {
  if (to < 0 || to >= attachments.length) return attachments;
  const next = [...attachments];
  const [item] = next.splice(from, 1);
  if (!item) return attachments;
  next.splice(to, 0, item);
  return next;
}

function estimateContextSize(attachments: ChatAttachment[]): string {
  const chars = attachments.reduce(
    (sum, item) => sum + (item.visibleText?.length ?? item.note?.length ?? 0),
    0,
  );
  if (chars <= 0) return "files only";
  return `~${Math.ceil(chars / 4).toLocaleString()} tokens`;
}
