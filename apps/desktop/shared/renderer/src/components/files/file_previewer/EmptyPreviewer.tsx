import { FileText } from "lucide-react";
import type { AppLanguage } from "../../../navigation";

export function EmptyPreviewer({
  language,
}: {
  language: AppLanguage;
}): React.JSX.Element {
  const zh = language === "zh";
  return (
    <div className="files-preview-empty">
      <FileText size={24} />
      <h3>{zh ? "选择文件" : "Select a file"}</h3>
      <p>
        {zh
          ? "文件预览会显示在 Files 上下文内部，不会替换聊天区。"
          : "File preview stays inside Files and does not replace chat."}
      </p>
    </div>
  );
}
