import { FileX } from "lucide-react";
import { describeMissingWorkspacePreview } from "../../../workspacePreview";
import type { PreviewerProps } from "./types";

/**
 * Shown when the preview came back as `missing: true`: the artifact was deleted,
 * moved or renamed after the agent wrote the message. Without this the pane
 * would fall through to the metadata view and report `0 B`, which looks like an
 * empty file rather than a missing one.
 */
export function MissingPreviewer({
  language,
  preview,
}: PreviewerProps): React.JSX.Element {
  const zh = language === "zh";
  return (
    <div className="files-preview-missing" data-resource-state="deleted">
      <FileX size={22} />
      <h3>{preview.name}</h3>
      <p>{describeMissingWorkspacePreview(zh ? "zh" : "en")}</p>
      <dl>
        <div>
          <dt>{zh ? "路径" : "Path"}</dt>
          <dd>{preview.relativePath || preview.path}</dd>
        </div>
      </dl>
    </div>
  );
}
