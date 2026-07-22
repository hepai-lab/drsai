import { FileText, ListPlus } from "lucide-react";
import type {
  ChatAttachment,
  WorkspaceInstructionSummary,
} from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";

export function InstructionChainPreview({
  attachments,
  instructions,
  language,
  onChange,
}: {
  attachments: ChatAttachment[];
  instructions: WorkspaceInstructionSummary[];
  language: AppLanguage;
  onChange: (attachments: ChatAttachment[]) => void;
}): React.JSX.Element | null {
  const zh = language === "zh";
  if (instructions.length === 0) return null;
  return (
    <section className="files-instruction-chain" aria-label="Workspace instructions">
      <div className="files-instruction-title">
        <span>{zh ? "工作区指令" : "Instructions"}</span>
        <small>{instructions.length} files</small>
      </div>
      <div className="files-instruction-list">
        {instructions.map((instruction) => {
          const inBasket = attachments.some((item) => item.path === instruction.path);
          return (
            <article key={instruction.path} className="files-instruction-item">
              <div title={instruction.path}>
                <FileText size={13} />
                <span>{instruction.name}</span>
                <small>{instruction.truncated ? "truncated" : "ready"}</small>
              </div>
              <p>{instruction.content || "No instruction content."}</p>
              <button
                type="button"
                disabled={inBasket}
                onClick={() =>
                  onChange([
                    ...attachments,
                    {
                      kind: "file",
                      path: instruction.path,
                      name: instruction.name,
                      visibleText: instruction.content,
                      note: `Workspace instruction selected from Files context. Truncated: ${instruction.truncated}.`,
                    },
                  ])
                }
              >
                <ListPlus size={13} />
                {inBasket ? (zh ? "已加入" : "Added") : (zh ? "加入" : "Add")}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
