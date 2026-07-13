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

export function FilePreviewer({
  language,
  preview,
}: {
  language: AppLanguage;
  preview: WorkspaceFilePreview | null;
}): React.JSX.Element {
  if (!preview) return <EmptyPreviewer language={language} />;
  if (preview.kind === "notebook") return <NotebookPreviewer language={language} preview={preview} />;
  if (preview.outline?.length) return <OutlinePreviewer language={language} preview={preview} />;
  if (preview.kind === "image") return <ImagePreviewer language={language} preview={preview} />;
  if (preview.kind === "table") return <TablePreviewer language={language} preview={preview} />;
  if (preview.kind === "markdown") return <MarkdownPreviewer language={language} preview={preview} />;
  if (preview.kind === "html") return <HtmlPreviewer language={language} preview={preview} />;
  if (preview.kind === "json" || preview.kind === "structured" || preview.kind === "config") {
    return <StructuredPreviewer language={language} preview={preview} />;
  }
  if (preview.kind === "pdf") return <PdfPreviewer language={language} preview={preview} />;
  if (preview.kind === "office") return <OfficePreviewer language={language} preview={preview} />;
  if (preview.kind === "media") return <MediaPreviewer language={language} preview={preview} />;
  if (preview.content) return <TextPreviewer language={language} preview={preview} />;
  return <MetadataPreviewer language={language} preview={preview} />;
}

export { FilePreviewer as FilePreview };
