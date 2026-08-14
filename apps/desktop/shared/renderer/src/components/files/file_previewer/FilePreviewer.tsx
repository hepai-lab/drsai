import type { WorkspaceFilePreview } from "@shared/desktopApi";
import type { AppLanguage } from "../../../navigation";
import { EmptyPreviewer } from "./EmptyPreviewer";
import { HtmlPreviewer } from "./HtmlPreviewer";
import { ImagePreviewer } from "./ImagePreviewer";
import { MarkdownPreviewer } from "./MarkdownPreviewer";
import { MediaPreviewer } from "./MediaPreviewer";
import { MetadataPreviewer } from "./MetadataPreviewer";
import { NotebookPreviewer } from "./NotebookPreviewer";
import { OfficePreviewer } from "./OfficePreviewer";
import { OutlinePreviewer } from "./OutlinePreviewer";
import { PdfPreviewer } from "./PdfPreviewer";
import { StructuredPreviewer } from "./StructuredPreviewer";
import { TablePreviewer } from "./TablePreviewer";
import { TextPreviewer } from "./TextPreviewer";
import type { LineHighlight } from "./types";

export function FilePreviewer({
  language,
  preview,
  highlight,
}: {
  language: AppLanguage;
  preview: WorkspaceFilePreview | null;
  /** Cited line range, when the file was opened to check a claim. */
  highlight?: LineHighlight;
}): React.JSX.Element {
  if (!preview) return <EmptyPreviewer language={language} />;
  if (preview.kind === "notebook") return <NotebookPreviewer language={language} preview={preview} />;
  // An outline hides the lines a citation points at, so a cited file is shown
  // in full even when it is large enough that browsing would summarise it.
  if (preview.outline?.length && !highlight) return <OutlinePreviewer language={language} preview={preview} />;
  if (preview.kind === "image") return <ImagePreviewer language={language} preview={preview} />;
  if (preview.kind === "table") return <TablePreviewer language={language} preview={preview} />;
  if (preview.kind === "markdown") return <MarkdownPreviewer language={language} preview={preview} highlight={highlight} />;
  if (preview.kind === "html") return <HtmlPreviewer language={language} preview={preview} />;
  if (preview.kind === "json" || preview.kind === "structured" || preview.kind === "config") {
    return <StructuredPreviewer language={language} preview={preview} />;
  }
  if (preview.kind === "pdf") return <PdfPreviewer language={language} preview={preview} />;
  if (preview.kind === "office") return <OfficePreviewer language={language} preview={preview} />;
  if (preview.kind === "media") return <MediaPreviewer language={language} preview={preview} />;
  if (preview.content) return <TextPreviewer language={language} preview={preview} highlight={highlight} />;
  return <MetadataPreviewer language={language} preview={preview} />;
}

export { FilePreviewer as FilePreview };
