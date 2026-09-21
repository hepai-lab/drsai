import type { WorkspaceFilePreview } from "@shared/desktopApi";
import type { AppLanguage } from "../../../navigation";
import { EmptyPreviewer } from "./EmptyPreviewer";
import { HtmlPreviewer } from "./HtmlPreviewer";
import { ImagePreviewer } from "./ImagePreviewer";
import { MarkdownPreviewer } from "./MarkdownPreviewer";
import { MediaPreviewer } from "./MediaPreviewer";
import { MetadataPreviewer } from "./MetadataPreviewer";
import { MissingPreviewer } from "./MissingPreviewer";
import { NotebookPreviewer } from "./NotebookPreviewer";
import { OfficePreviewer } from "./OfficePreviewer";
import { OutlinePreviewer } from "./OutlinePreviewer";
import { PdfPreviewer } from "./PdfPreviewer";
import { TablePreviewer } from "./TablePreviewer";
import { TextPreviewer } from "./TextPreviewer";
import type { LineHighlight } from "./types";

function isSourceTextKind(kind: WorkspaceFilePreview["kind"]): boolean {
  return kind === "text"
    || kind === "code"
    || kind === "json"
    || kind === "config"
    || kind === "structured";
}

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
  // The file is gone (deleted/moved/renamed): say so instead of rendering an
  // empty metadata pane that reads like a 0-byte file.
  if (preview.missing) return <MissingPreviewer language={language} preview={preview} />;
  if (preview.kind === "notebook") return <NotebookPreviewer language={language} preview={preview} />;
  // Outline mode is explicit; never hide source text behind a symbol list.
  if (preview.mode === "outline" && preview.outline?.length && !highlight) {
    return <OutlinePreviewer language={language} preview={preview} />;
  }
  if (preview.kind === "image") return <ImagePreviewer language={language} preview={preview} />;
  if (preview.kind === "table") return <TablePreviewer language={language} preview={preview} />;
  if (preview.kind === "markdown") return <MarkdownPreviewer language={language} preview={preview} highlight={highlight} />;
  if (preview.kind === "html") return <HtmlPreviewer language={language} preview={preview} />;
  if (preview.kind === "pdf") return <PdfPreviewer language={language} preview={preview} />;
  if (preview.kind === "office") return <OfficePreviewer language={language} preview={preview} />;
  if (preview.kind === "media") return <MediaPreviewer language={language} preview={preview} />;
  // Text / code / json / yaml / css / sql: always show the source file body.
  if (preview.content != null && isSourceTextKind(preview.kind)) {
    return <TextPreviewer language={language} preview={preview} highlight={highlight} />;
  }
  if (preview.content != null) {
    return <TextPreviewer language={language} preview={preview} highlight={highlight} />;
  }
  if (preview.outline?.length) {
    return <OutlinePreviewer language={language} preview={preview} />;
  }
  return <MetadataPreviewer language={language} preview={preview} />;
}

export { FilePreviewer as FilePreview };
