import React from "react";
import { FileText, Download, PencilLine, Eye, X } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";

import type { MessageFileItem, FilesEvent } from "../components/types/datamodel";
import MarkdownRenderer from "../components/common/markdownrender";
import { fileAPI } from "../components/views/api";
import { appContext } from "../hooks/provider";

interface FilePreviewPageProps {
  file?: MessageFileItem | null;
  sessionId?: number | null;
  onFileEvent?: (event: FilesEvent) => void;
  /** Hide all edit/save affordances. Used by the DocMaster 模板库 preview flow. */
  readOnly?: boolean;
}

/* ============================================================
   WordEditor: Online .docx editor with STRUCTURED EDITS
   - Loads .docx via mammoth.js for display
   - Tracks edits as structured operations
   - Preserves original formatting when saving
   ============================================================ */
interface EditOperation {
  type: string;
  old_text?: string;
  new_text?: string;
  text?: string;
  content?: string;
  formatting?: { bold?: boolean | null; italic?: boolean | null };
  paragraph_index?: number;
}

interface WordEditorProps {
  file: MessageFileItem;
  onClose: () => void;
  onFileEvent?: (event: FilesEvent) => void;
}

// Helper: Extract plain text from HTML
const extractTextFromHTML = (html: string): string[] => {
  const div = document.createElement("div");
  div.innerHTML = html;
  const paragraphs: string[] = [];
  const children = div.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li");
  children.forEach((el) => {
    paragraphs.push(el.textContent?.trim() || "");
  });
  if (paragraphs.length === 0) {
    return div.textContent?.split(/\n+/).map((s) => s.trim()).filter(Boolean) || [];
  }
  return paragraphs;
};

// WordEditor component with TipTap
const WordEditor: React.FC<WordEditorProps> = ({ file, onClose, onFileEvent }) => {
  const { user, darkMode } = React.useContext(appContext);
  const userId = user?.email || "";
  const isDark = darkMode === "dark";
  
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [htmlContent, setHtmlContent] = React.useState<string>("");
  const [originalParagraphs, setOriginalParagraphs] = React.useState<string[]>([]);
  const [contentLoaded, setContentLoaded] = React.useState(false);
  
  // Load mammoth.js and convert docx to HTML
  React.useEffect(() => {
    const initMammoth = async () => {
      try {
        const { convertToHtml } = await import("mammoth");
        
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
        
        // Always use HTML conversion — TipTap natively understands HTML
        // (markdown would be treated as a single text blob)
        const { value: rawHtml } = await convertToHtml({ arrayBuffer });
        const content = rawHtml
          .replace(/<img[^>]*>/gi, "")
          .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, "<p>[表格内容]</p>");
        console.log("[WordEditor] HTML length:", content.length);
        console.log("[WordEditor] First 300 chars:", content.slice(0, 300));
        
        // Extract paragraphs from HTML using DOM parsing for accurate structure
        const originalParas = extractTextFromHTML(content);
        
        setOriginalParagraphs(originalParas);
        setHtmlContent(content);
        setLoading(false);
      } catch (e) {
        console.error("[WordEditor] Error:", e);
        setError(e instanceof Error ? e.message : "加载失败");
        setLoading(false);
      }
    };
    
    void initMammoth();
  }, [file]);
  
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Typography,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose max-w-none focus:outline-none min-h-[350px] p-4",
      },
    },
  });
  
  // Update editor content when mammoth finishes loading
  React.useEffect(() => {
    if (editor && htmlContent) {
      console.log("[WordEditor] Setting content, length:", htmlContent.length);
      try {
        editor.commands.setContent(htmlContent);
      } catch (e) {
        console.error("[WordEditor] setContent error:", e);
      }
      setContentLoaded(true);
    }
  }, [editor, htmlContent]);
  
  // Simple similarity calculation for change detection
  const calculateSimilarity = (s1: string, s2: string): number => {
    if (s1 === s2) return 1;
    if (!s1 || !s2) return 0;
    const words1 = new Set(s1.toLowerCase().split(/\s+/).filter(Boolean));
    const words2 = new Set(s2.toLowerCase().split(/\s+/).filter(Boolean));
    if (words1.size === 0 && words2.size === 0) return 1;
    if (words1.size === 0 || words2.size === 0) return 0;
    const intersection = new Set([...words1].filter((x) => words2.has(x))).size;
    const union = new Set([...words1, ...words2]).size;
    return union > 0 ? (2 * intersection) / union : 0;
  };
  
  const generateEdits = React.useCallback((): EditOperation[] => {
    if (!editor) return [];
    const doc = editor.getJSON();
    const edits: EditOperation[] = [];
    
    const currentParagraphs: string[] = [];
    const traverse = (content: any[]) => {
      content.forEach((node) => {
        if (node.type === "paragraph" || node.type?.startsWith("heading")) {
          let text = "";
          if (node.content) {
            node.content.forEach((child: any) => {
              if (child.type === "text" && child.text) text += child.text;
            });
          }
          currentParagraphs.push(text);
        } else if (node.content) {
          traverse(node.content);
        }
      });
    };
    if (doc.content) traverse(doc.content);
    
    for (let i = 0; i < currentParagraphs.length; i++) {
      const currentText = currentParagraphs[i];
      let bestMatchIdx = -1;
      let bestSimilarity = 0;
      
      for (let j = 0; j < originalParagraphs.length; j++) {
        if (i === j || originalParagraphs[j] === currentText) {
          bestMatchIdx = j;
          bestSimilarity = 1;
          break;
        }
        const similarity = calculateSimilarity(originalParagraphs[j], currentText);
        if (similarity > bestSimilarity && similarity > 0.5) {
          bestSimilarity = similarity;
          bestMatchIdx = j;
        }
      }
      
      if (bestMatchIdx === -1) {
        edits.push({ type: "add_paragraph", content: currentText, paragraph_index: i });
      } else if (originalParagraphs[bestMatchIdx] !== currentText) {
        edits.push({ type: "replace_text", old_text: originalParagraphs[bestMatchIdx], new_text: currentText, paragraph_index: bestMatchIdx });
      }
    }
    
    return edits;
  }, [editor, originalParagraphs]);
  
  const handleSave = React.useCallback(async () => {
    if (originalParagraphs.length === 0) {
      alert("无法获取原始内容");
      return;
    }
    if (!file.url && !file.base64_content) {
      alert("文件内容不可用（无 URL 或 base64）");
      return;
    }
    
    setSaving(true);
    try {
      const edits = generateEdits();
      if (edits.length === 0) {
        alert("没有检测到任何更改");
        setSaving(false);
        return;
      }
      
      const result = await fileAPI.editDocx(
        userId,
        file.name || "",
        originalParagraphs,
        edits,
        file.url || null,
        file.base64_content || null,
      );
      
      if (result.success) {
        // Emit a FilesEvent so the file shows up in 文件空间 immediately
        if (onFileEvent) {
          const savedFile: MessageFileItem = {
            name: result.saved_name || file.name || "edited.docx",
            url: result.url || "",
            base64_content: "",
            size: file.size,
            mime_type: file.mime_type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            description: `Edited version of ${file.name || "document"}`,
            download_method: result.url ? "url" : "base64",
          };
          onFileEvent({
            source: "WordEditor",
            content: {
              files: [savedFile],
              title: result.saved_name || "Edited Document",
              description: `Edited version of ${file.name || "document"}`,
              send_time_stamp: Date.now(),
            },
            type: "FilesEvent",
          });
        }
        alert(`文件已保存到文件空间：${result.saved_name}`);
        onClose();
      } else {
        alert(`保存失败：${result.message}`);
      }
    } catch (e) {
      alert(`保存失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setSaving(false);
    }
  }, [userId, file, originalParagraphs, generateEdits, onClose, onFileEvent]);
  
  const bg = isDark ? "bg-[#11151c]" : "bg-white";
  const textColor = isDark ? "text-white" : "text-gray-900";
  const borderColor = isDark ? "border-white/10" : "border-gray-200";
  const hoverBg = isDark ? "hover:bg-white/5" : "hover:bg-gray-100";
  
  const toolbarButton = (label: string, onClick: () => void, active = false) => (
    <button type="button" onClick={onClick} className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${active ? "bg-blue-600 text-white" : `${hoverBg} ${textColor}`}`}>
      {label}
    </button>
  );
  
  if (loading) {
    return (
      <div className={`fixed inset-0 flex items-center justify-center z-50 ${isDark ? "bg-gray-900" : "bg-white"}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mx-auto mb-4" />
          <p className={textColor}>正在加载文档...</p>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className={`fixed inset-0 flex items-center justify-center z-50 ${isDark ? "bg-gray-900" : "bg-white"}`}>
        <div className="text-center p-8">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <p className="text-xl mb-4">{error}</p>
          <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">关闭</button>
        </div>
      </div>
    );
  }
  
  return (
    <div className={`fixed inset-0 flex flex-col z-50 ${bg}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor}`}>
        <div className="flex items-center gap-2">
          {editor && (
            <>
              {toolbarButton("B", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
              {toolbarButton("I", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
              {toolbarButton("U", () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"))}
              <div className="w-px h-6 bg-gray-400 mx-1" />
              {toolbarButton("H1", () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }))}
              {toolbarButton("H2", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
              {toolbarButton("P", () => editor.chain().focus().setParagraph().run(), editor.isActive("paragraph"))}
              <div className="w-px h-6 bg-gray-400 mx-1" />
              {toolbarButton("≡L", () => editor.chain().focus().setTextAlign("left").run(), editor.isActive({ textAlign: "left" }))}
              {toolbarButton("≡C", () => editor.chain().focus().setTextAlign("center").run(), editor.isActive({ textAlign: "center" }))}
              {toolbarButton("≡R", () => editor.chain().focus().setTextAlign("right").run(), editor.isActive({ textAlign: "right" }))}
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => void handleSave()} disabled={saving} className="px-4 py-1.5 bg-green-600 text-white rounded font-medium hover:bg-green-700 disabled:opacity-50">
            {saving ? "保存中..." : "保存到文件空间"}
          </button>
          <button onClick={onClose} className={`px-4 py-1.5 rounded font-medium ${hoverBg} ${textColor}`}>
            关闭
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto p-6">
        <div className={`max-w-4xl mx-auto rounded-lg shadow-lg overflow-hidden ${isDark ? "bg-gray-800" : "bg-white"}`}>
          <style>{`
            .ProseMirror { outline: none; min-height: 500px; padding: 32px 40px; font-size: 15px; line-height: 1.75; }
            .ProseMirror p { margin: 0.6em 0; text-indent: 0; }
            .ProseMirror p:first-child { margin-top: 0; }
            .ProseMirror p + p { margin-top: 0.6em; }
            .ProseMirror h1 { font-size: 1.75em; font-weight: bold; margin: 1.2em 0 0.6em; }
            .ProseMirror h2 { font-size: 1.4em; font-weight: bold; margin: 1em 0 0.5em; }
            .ProseMirror h3 { font-size: 1.2em; font-weight: bold; margin: 0.8em 0 0.4em; }
            .ProseMirror h4, .ProseMirror h5, .ProseMirror h6 { font-size: 1.1em; font-weight: bold; margin: 0.6em 0 0.3em; }
            .ProseMirror ul, .ProseMirror ol { padding-left: 1.5em; margin: 0.5em 0; }
            .ProseMirror li { margin: 0.25em 0; }
            .ProseMirror blockquote { border-left: 3px solid #ccc; padding-left: 1em; margin: 0.8em 0; margin-left: 0; color: #666; }
            .ProseMirror code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-family: monospace; }
            .ProseMirror.ProseMirror-focused { outline: none; }
            .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #aaa; float: left; height: 0; pointer-events: none; }
            ${isDark ? `
            .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 { color: #fff; }
            .ProseMirror p { color: #e5e5e5; }
            .ProseMirror li { color: #e5e5e5; }
            ` : ''}
          `}</style>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const WORD_EXTENSIONS = new Set(["doc", "docx"]);
const PPT_EXTENSIONS = new Set(["ppt", "pptx"]);
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

const isPptFile = (file: MessageFileItem): boolean => {
  if (
    file.mime_type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    file.mime_type === "application/vnd.ms-powerpoint"
  )
    return true;
  return PPT_EXTENSIONS.has(getExtension(file.name || ""));
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

const FilePreviewPage: React.FC<FilePreviewPageProps> = ({ file = null, sessionId, onFileEvent, readOnly = false }) => {
  const { darkMode } = React.useContext(appContext);
  const isDark = darkMode === "dark";
  
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [originalText, setOriginalText] = React.useState("");
  const [editedText, setEditedText] = React.useState("");
  const [isEditing, setIsEditing] = React.useState(true);
  const [showWordEditor, setShowWordEditor] = React.useState(false);

  const dataUrl = React.useMemo(() => (file ? fileToDataUrl(file) : null), [file]);
  const textMode = React.useMemo(() => (file ? isTextFile(file) : false), [file]);
  const markdownMode = React.useMemo(() => (file ? isMarkdownFile(file) : false), [file]);
  const imageMode = React.useMemo(() => (file ? isImageFile(file) : false), [file]);
  const pdfMode = React.useMemo(() => (file ? isPdfFile(file) : false), [file]);
  const wordMode = React.useMemo(() => (file ? isWordFile(file) : false), [file]);
  const pptMode = React.useMemo(() => (file ? isPptFile(file) : false), [file]);

  const wordContainerRef = React.useRef<HTMLDivElement>(null);
  const [wordLoading, setWordLoading] = React.useState(false);
  const [wordError, setWordError] = React.useState<string | null>(null);

  // PPTX: fast-path uses backend-rendered slide images (`preview_slides`);
  // otherwise we render the .pptx in-browser via pptx-preview into pptContainerRef.
  const pptSlides = React.useMemo(() => {
    const candidate = file as ((MessageFileItem & { preview_slides?: Array<{ index: number; name: string; url: string }> }) | null);
    const raw = candidate?.preview_slides || (candidate as { previewSlides?: Array<{ index: number; name: string; url: string }> } | null)?.previewSlides;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw;
    }
    return [];
  }, [file]);
  const pptContainerRef = React.useRef<HTMLDivElement>(null);
  const [pptLoading, setPptLoading] = React.useState(false);
  const [pptError, setPptError] = React.useState<string | null>(null);

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

  // Render .pptx in-browser via pptx-preview when the backend hasn't already
  // supplied rendered slide images (pptSlides). Mirrors the docx-preview flow.
  React.useEffect(() => {
    let cancelled = false;
    if (!file || !pptMode || pptSlides.length > 0) return;

    const loadPpt = async () => {
      setPptLoading(true);
      setPptError(null);
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
        const container = pptContainerRef.current;
        if (!container) return;
        container.innerHTML = "";
        const { init } = await import("pptx-preview");
        // Scale slides to the container's width while keeping 16:9.
        const width = Math.max(container.clientWidth || 960, 480);
        const height = Math.round((width * 9) / 16);
        const previewer = init(container, { width, height });
        await previewer.preview(arrayBuffer);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "加载失败";
        setPptError(`文件加载失败：${message}`);
      } finally {
        if (!cancelled) setPptLoading(false);
      }
    };

    void loadPpt();
    return () => {
      cancelled = true;
    };
  }, [file, pptMode, pptSlides.length]);

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
    <>
      {showWordEditor && file && (
        <WordEditor key={Date.now()} file={file} onClose={() => setShowWordEditor(false)} onFileEvent={onFileEvent} />
      )}
    
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex-shrink-0 px-4 py-3 border-b border-border-primary/30 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-primary truncate">{file.name}</h2>
          <p className="text-xs text-secondary mt-1 truncate">{file.description || "无描述"}</p>
        </div>
        {textMode && !readOnly && (
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
        {wordMode && !readOnly && (
          <button
            type="button"
            onClick={() => setShowWordEditor(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25"
          >
            <PencilLine className="w-3.5 h-3.5" />
            在线编辑
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {loading && <div className="text-sm text-secondary">正在加载文件内容...</div>}
        {error && <div className="text-sm text-red-500">{error}</div>}

        {!loading && !error && textMode && (
          isEditing && !readOnly ? (
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
            <div
              ref={wordContainerRef}
              className={`h-full overflow-auto bg-white rounded-md border border-border-primary/30 p-4${wordLoading || wordError ? " hidden" : ""}`}
            />
          </div>
        )}

        {!loading && !error && pptMode && (
          <div className="space-y-4">
            {pptSlides.length > 0 ? (
              pptSlides.map((slide) => (
                <div key={slide.name} className="rounded-lg border border-border-primary/30 bg-white p-3">
                  <div className="mb-2 text-xs text-secondary">第 {slide.index} 页</div>
                  <img src={slide.url} alt={`Slide ${slide.index}`} className="w-full rounded-md border border-border-primary/20" />
                </div>
              ))
            ) : (
              <>
                {pptLoading && <div className="text-sm text-secondary">正在加载幻灯片...</div>}
                {pptError && <div className="text-sm text-red-500">{pptError}</div>}
                <div
                  ref={pptContainerRef}
                  className={`overflow-auto bg-white rounded-md border border-border-primary/30 p-2${pptLoading || pptError ? " hidden" : ""}`}
                />
              </>
            )}
          </div>
        )}

        {!loading && !error && !textMode && !imageMode && !pdfMode && !wordMode && !pptMode && (
          <div className="text-sm text-secondary">
            当前文件类型暂不支持在线编辑，可使用下载按钮查看。
          </div>
        )}
      </div>
    </div>
    </>
  );
};

export default FilePreviewPage;
