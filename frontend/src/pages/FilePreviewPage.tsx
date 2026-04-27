import React from "react";
import { FileText, Download, PencilLine, Eye } from "lucide-react";

import type { MessageFileItem } from "../components/types/datamodel";
import MarkdownRenderer from "../components/common/markdownrender";

interface FilePreviewPageProps {
  file?: MessageFileItem | null;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const WORD_EXTENSIONS = new Set(["doc", "docx"]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "yaml",
  "yml",
  "xml",
  "csv",
  "log",
  "py",
  "ts",
  "tsx",
  "js",
  "jsx",
  "java",
  "c",
  "cpp",
  "go",
  "rs",
  "sh",
  "html",
  "css",
  "scss",
]);

const getExtension = (name: string): string => {
  const index = name.lastIndexOf(".");
  if (index < 0) return "";
  return name.slice(index + 1).toLowerCase();
};

const base64ToUtf8 = (base64: string): string => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
};

const fileToDataUrl = (file: MessageFileItem): string | null => {
  if (file.download_method === "url" && file.url) return file.url;
  if (file.download_method === "base64" && file.base64_content) {
    const mime = file.mime_type || "application/octet-stream";
    return `data:${mime};base64,${file.base64_content}`;
  }
  return null;
};

const isTextFile = (file: MessageFileItem): boolean => {
  if (file.mime_type?.startsWith("text/")) return true;
  if (file.mime_type?.includes("json")) return true;
  return TEXT_EXTENSIONS.has(getExtension(file.name || ""));
};

const isImageFile = (file: MessageFileItem): boolean => {
  if (file.mime_type?.startsWith("image/")) return true;
  return IMAGE_EXTENSIONS.has(getExtension(file.name || ""));
};

const isPdfFile = (file: MessageFileItem): boolean => {
  if (file.mime_type === "application/pdf") return true;
  return getExtension(file.name || "") === "pdf";
};

const isWordFile = (file: MessageFileItem): boolean => {
  if (
    file.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.mime_type === "application/msword"
  )
    return true;
  return WORD_EXTENSIONS.has(getExtension(file.name || ""));
};

const isMarkdownFile = (file: MessageFileItem): boolean => {
  const ext = getExtension(file.name || "");
  return ext === "md" || ext === "markdown";
};

const normalizeMarkdownForPreview = (raw: string): string => {
  let text = raw.replace(/\r\n/g, "\n");

  text = text.replace(/<img[^>]*>/gi, (tag) => {
    const srcMatch = tag.match(/src\s*=\s*["']([^"']+)["']/i);
    const altMatch = tag.match(/alt\s*=\s*["']([^"']*)["']/i);
    const src = srcMatch?.[1] || "";
    const alt = altMatch?.[1] || "image";
    return src ? `\n![${alt}](${src})\n` : "";
  });

  text = text.replace(/<\/?(div|p)[^>]*>/gi, "\n");

  // Insert line breaks before heading markers if backend flattened lines.
  text = text.replace(/(^|[^\n])(#{1,6}\s)/g, (_match, prefix: string, heading: string) => {
    return `${prefix}\n${heading}`;
  });

  // Insert line breaks before markdown list markers in flattened content.
  text = text.replace(/\s(-\s+\d+\.)/g, "\n$1");

  return text.replace(/\n{3,}/g, "\n\n").trim();
};

const FilePreviewPage: React.FC<FilePreviewPageProps> = ({ file = null }) => {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [originalText, setOriginalText] = React.useState("");
  const [editedText, setEditedText] = React.useState("");
  const [isEditing, setIsEditing] = React.useState(true);

  const dataUrl = React.useMemo(() => (file ? fileToDataUrl(file) : null), [file]);
  const textMode = React.useMemo(() => (file ? isTextFile(file) : false), [file]);
  const markdownMode = React.useMemo(() => (file ? isMarkdownFile(file) : false), [file]);
  const imageMode = React.useMemo(() => (file ? isImageFile(file) : false), [file]);
  const pdfMode = React.useMemo(() => (file ? isPdfFile(file) : false), [file]);
  const wordMode = React.useMemo(() => (file ? isWordFile(file) : false), [file]);

  const wordContainerRef = React.useRef<HTMLDivElement>(null);
  const [wordLoading, setWordLoading] = React.useState(false);
  const [wordError, setWordError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!file || !wordMode) return;

    const loadWord = async () => {
      setWordLoading(true);
      setWordError(null);
      try {
        let arrayBuffer: ArrayBuffer;
        if (file.download_method === "base64" && file.base64_content) {
          const binary = atob(file.base64_content);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          arrayBuffer = bytes.buffer;
        } else if (file.download_method === "url" && file.url) {
          const response = await fetch(file.url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          arrayBuffer = await response.arrayBuffer();
        } else {
          throw new Error("当前文件没有可用内容");
        }

        if (cancelled) return;
        const container = wordContainerRef.current;
        if (!container) return;
        container.innerHTML = "";
        const { renderAsync } = await import("docx-preview");
        await renderAsync(arrayBuffer, container);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "加载失败";
        setWordError(`文件加载失败：${message}`);
      } finally {
        if (!cancelled) setWordLoading(false);
      }
    };

    void loadWord();
    return () => {
      cancelled = true;
    };
  }, [file, wordMode]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError(null);
      setOriginalText("");
      setEditedText("");
      if (!file || !textMode) return;

      setLoading(true);
      try {
        let text = "";
        if (file.download_method === "base64" && file.base64_content) {
          text = base64ToUtf8(file.base64_content);
        } else if (file.download_method === "url" && file.url) {
          const response = await fetch(file.url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          text = await response.text();
        } else {
          throw new Error("当前文件没有可用内容");
        }

        if (cancelled) return;
        setOriginalText(text);
        setEditedText(text);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "加载失败";
        setError(`文件加载失败：${message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [file, textMode]);

  const hasChanges = editedText !== originalText;

  const downloadEdited = React.useCallback(() => {
    if (!file) return;
    const blob = new Blob([editedText], { type: file.mime_type || "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = file.name || "edited-file.txt";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(href);
  }, [editedText, file]);

  if (!file) {
    return (
      <div className="flex items-center justify-center h-full text-secondary">
        <div className="text-center">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <h2 className="text-base font-medium text-primary">文件预览</h2>
          <p className="mt-2 text-sm opacity-60">请选择右侧文件进行预览</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex-shrink-0 px-4 py-3 border-b border-border-primary/30 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-primary truncate">{file.name}</h2>
          <p className="text-xs text-secondary mt-1 truncate">{file.description || "无描述"}</p>
        </div>
        {textMode && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsEditing((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium bg-tertiary/20 text-primary hover:bg-tertiary/30"
            >
              {isEditing ? <Eye className="w-3.5 h-3.5" /> : <PencilLine className="w-3.5 h-3.5" />}
              {isEditing ? "预览模式" : "编辑模式"}
            </button>
            <button
              type="button"
              onClick={downloadEdited}
              disabled={!hasChanges}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${hasChanges
                  ? "bg-accent/15 text-accent hover:bg-accent/25"
                  : "bg-tertiary/20 text-secondary cursor-not-allowed"
                }`}
            >
              <Download className="w-3.5 h-3.5" />
              保存为副本
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {loading && <div className="text-sm text-secondary">正在加载文件内容...</div>}
        {error && <div className="text-sm text-red-500">{error}</div>}

        {!loading && !error && textMode && (
          isEditing ? (
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="w-full h-full min-h-[300px] resize-none rounded-lg border border-border-primary/40 bg-primary px-3 py-2 text-sm text-primary outline-none focus:border-accent/50"
            />
          ) : markdownMode ? (
            <div className="text-primary bg-tertiary/10 border border-border-primary/25 rounded-lg p-3">
              <MarkdownRenderer content={normalizeMarkdownForPreview(editedText)} />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-sm text-primary bg-tertiary/10 border border-border-primary/25 rounded-lg p-3">
              {editedText}
            </pre>
          )
        )}

        {!loading && !error && imageMode && dataUrl && (
          <div className="h-full flex items-start justify-center">
            <img src={dataUrl} alt={file.name} className="max-h-full max-w-full object-contain rounded-md" />
          </div>
        )}

        {!loading && !error && pdfMode && dataUrl && (
          <iframe src={dataUrl} title={file.name} className="w-full h-full min-h-[500px] rounded-md border border-border-primary/30" />
        )}

        {!loading && !error && wordMode && (
          <div className="h-full">
            {wordLoading && <div className="text-sm text-secondary">正在加载文件内容...</div>}
            {wordError && <div className="text-sm text-red-500">{wordError}</div>}
            {!wordLoading && !wordError && (
              <div
                ref={wordContainerRef}
                className="h-full overflow-auto bg-white rounded-md border border-border-primary/30 p-4"
              />
            )}
          </div>
        )}

        {!loading && !error && !textMode && !imageMode && !pdfMode && !wordMode && (
          <div className="text-sm text-secondary">
            当前文件类型暂不支持在线编辑，可使用下载按钮查看。
          </div>
        )}
      </div>
    </div>
  );
};

export default FilePreviewPage;
