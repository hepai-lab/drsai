import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, PencilLine, Save, X, ZoomIn, ZoomOut } from 'lucide-react';
import { appContext } from '../hooks/provider';
import { useRightPanelStore } from '../store/rightPanel';
import { cloudAPI } from '../components/views/api';
import FilePreviewPage, { type FilePreviewPageHandle } from '../pages/FilePreviewPage';

interface SelectionPopupProps {
  x: number;
  y: number;
  onAdd: () => void;
}

const SelectionPopup: React.FC<SelectionPopupProps> = ({ x, y, onAdd }) => (
  createPortal(
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onAdd();
      }}
      style={{ position: 'fixed', left: x, top: y, zIndex: 9999 }}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-accent text-white shadow-lg hover:bg-accent/90 transition-colors select-none"
    >
      + 添加到对话
    </button>,
    document.body
  )
);

const CanvasFilePreviewPane: React.FC = () => {
  const { user } = useContext(appContext);
  const previewFile = useRightPanelStore((s) => s.previewFile);
  const setPreviewFile = useRightPanelStore((s) => s.setPreviewFile);
  const [previewEditable, setPreviewEditable] = useState(false);

  // userZoom: multiplier relative to fit-to-width (1 = fit, 1.5 = 50% larger, etc.)
  const [userZoom, setUserZoom] = useState(1);
  const ZOOM_STEP = 0.15;
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 3.0;

  const filePreviewRef = useRef<FilePreviewPageHandle>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const docxInnerRef = useRef<HTMLDivElement | null>(null);

  // Natural rendered width of the docx (fixed A4 pixels, never changes)
  const naturalWidthRef = useRef<number>(0);
  // Fit scale: how much to scale naturalWidth to fill the container
  const [fitScale, setFitScale] = useState<number | null>(null);
  // Natural height for scroll compensation
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);

  const isDocx = previewFile?.name
    ? /\.(doc|docx)$/i.test(previewFile.name) ||
      previewFile.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      previewFile.mime_type === 'application/msword'
    : false;

  const pptHasBackendSlides = Array.isArray(
    (previewFile as (typeof previewFile & { preview_slides?: unknown[] }) | null)?.preview_slides
  ) && ((previewFile as (typeof previewFile & { preview_slides?: unknown[] }) | null)?.preview_slides?.length ?? 0) > 0;

  const isPpt = previewFile?.name
    ? (/\.(ppt|pptx)$/i.test(previewFile.name) ||
      previewFile.mime_type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      previewFile.mime_type === 'application/vnd.ms-powerpoint') && !pptHasBackendSlides
    : false;

  const isPdf = previewFile?.name
    ? /\.pdf$/i.test(previewFile.name) || previewFile.mime_type === 'application/pdf'
    : false;

  const needsScaledPreview = isDocx || isPpt || isPdf;
  const isDocxRef = useRef(isDocx);
  isDocxRef.current = isDocx;

  const [popup, setPopup] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    setPreviewEditable(false);
    setUserZoom(1);
    setFitScale(null);
    setNaturalHeight(null);
    naturalWidthRef.current = 0;
    setPopup(null);
  }, [previewFile?.url]);

  const computeFitScale = useCallback(() => {
    const container = previewContainerRef.current;
    const nw = naturalWidthRef.current;
    if (!container || nw <= 0) return;
    const available = container.clientWidth;
    if (available <= 0) return;
    setFitScale(available / nw);
  }, []);

  const handleDocxReady = useCallback(() => {
    const el = docxInnerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        naturalWidthRef.current = el.scrollWidth;
        setNaturalHeight(el.scrollHeight);
        computeFitScale();
      });
    });
  }, [computeFitScale]);

  const handlePdfReady = useCallback(() => {
    const el = docxInnerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        naturalWidthRef.current = el.scrollWidth;
        setNaturalHeight(el.scrollHeight);
        computeFitScale();
      });
    });
  }, [computeFitScale]);

  // pptx-preview always renders at 960px wide
  const PPT_NATURAL_WIDTH = 960;
  const handlePptReady = useCallback(() => {
    const el = docxInnerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        naturalWidthRef.current = PPT_NATURAL_WIDTH;
        setNaturalHeight(el.scrollHeight);
        computeFitScale();
      });
    });
  }, [computeFitScale]);

  // Recompute fit scale when pane is resized
  useEffect(() => {
    if (!needsScaledPreview) return;
    const container = previewContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(computeFitScale);
    ro.observe(container);
    return () => ro.disconnect();
  }, [needsScaledPreview, computeFitScale]);

  // The actual CSS scale applied = fitScale * userZoom
  const scale = fitScale != null ? fitScale * userZoom : null;
  // Height the outer wrapper needs to be so the scroll container has the right size
  const wrapperHeight = scale != null && naturalHeight != null ? naturalHeight * scale : null;


  // Show popup on text selection within the preview container
  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;

    const onMouseUp = () => {
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim();
        if (!text || !sel || sel.rangeCount === 0) { setPopup(null); return; }
        const range = sel.getRangeAt(0);
        if (!el.contains(range.commonAncestorContainer)) { setPopup(null); return; }
        const rect = range.getBoundingClientRect();
        setPopup({ x: rect.right + 8, y: rect.bottom + 4, text });
      }, 10);
    };
    const onSelectionChange = () => {
      if (!window.getSelection()?.toString().trim()) setPopup(null);
    };

    el.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      el.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [previewFile]);

  const handleAddToChat = useCallback(() => {
    if (!popup?.text) return;
    window.dispatchEvent(
      new CustomEvent('drsai:chatinput:setValue', { detail: { text: popup.text, append: true } })
    );
    window.getSelection()?.removeAllRanges();
    setPopup(null);
  }, [popup]);

  const handleDownload = useCallback(() => {
    if (!previewFile?.url) return;
    window.open(previewFile.url, '_blank');
  }, [previewFile?.url]);

  const handleSave = useCallback(async () => {
    const content = filePreviewRef.current?.getEditedContent();
    if (!content || !previewFile) return;
    const gfsPath = previewFile.description?.startsWith('GFS: ')
      ? previewFile.description.slice(5)
      : null;
    if (!gfsPath) { alert('无法确定 GFS 路径'); return; }
    const lastSlash = gfsPath.lastIndexOf('/');
    const fileName = lastSlash > 0 ? gfsPath.slice(lastSlash + 1) : gfsPath;
    const file = new File([content.text], fileName, { type: content.mime_type });
    try {
      const userId = (user as { email?: string } | null)?.email ?? '';
      const { uploaded, errors } = await cloudAPI.uploadFiles([file], 'favorites', userId);
      if (errors.length > 0) {
        alert(`保存失败：${errors.map((e) => `${e.name}: ${e.error}`).join('; ')}`);
      } else if (uploaded.length > 0) {
        setPreviewFile(null);
        setPreviewEditable(false);
      }
    } catch (err) {
      alert(`保存异常：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [previewFile, user, setPreviewFile]);

  if (!previewFile) return null;

  return (
    <div className="flex flex-col h-full border-l border-border-primary/20 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-primary/20 flex-shrink-0">
        <span
          className="flex items-baseline gap-1.5 flex-1 min-w-0"
          title={`${previewFile.name}${previewFile.description ? ` — ${previewFile.description}` : ''}`}
        >
          <span className="text-xs text-primary flex-shrink-0">📄 {previewFile.name}</span>
          <span className="text-[10px] text-secondary truncate">{previewFile.description || '无描述'}</span>
        </span>
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
          <button
            type="button"
            onClick={() => setUserZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            title="缩小"
            className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] text-secondary w-8 text-center tabular-nums select-none">
            {Math.round(userZoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setUserZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            title="放大"
            className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-3 bg-border-primary/30 mx-0.5" />
          <button
            type="button"
            onClick={() => setPreviewEditable(true)}
            title="编辑"
            className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
          >
            <PencilLine className="w-3.5 h-3.5" />
          </button>
          {/* <button
            type="button"
            onClick={handleSave}
            title="收藏"
            className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
          </button> */}
          <button
            type="button"
            onClick={handleDownload}
            title="下载"
            className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { setPreviewFile(null); setPreviewEditable(false); }}
            title="关闭预览"
            className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        ref={previewContainerRef}
        className="flex-1 min-h-0 overflow-auto"
      >
        {needsScaledPreview ? (
          <>
            {/* Hidden off-screen render to measure natural dimensions before showing */}
            {scale == null && (
              <div style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', top: 0, left: 0 }}>
                <div ref={docxInnerRef}>
                  <FilePreviewPage
                    ref={filePreviewRef}
                    file={previewFile}
                    readOnly={!previewEditable}
                    onDocxReady={isDocx ? handleDocxReady : undefined}
                    onPptReady={isPpt ? handlePptReady : undefined}
                    onPdfReady={isPdf ? handlePdfReady : undefined}
                  />
                </div>
              </div>
            )}
            {/* Visible scaled view — only shown once fitScale is known */}
            {scale != null && (
              <div style={{
                height: wrapperHeight != null ? `${wrapperHeight}px` : 'auto',
                minHeight: '100%',
                // scaled width after transform; center it when smaller than container
                width: `${naturalWidthRef.current * scale}px`,
                margin: '0 auto',
              }}>
                <div
                  ref={docxInnerRef}
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    width: `${naturalWidthRef.current}px`,
                  }}
                >
                  <FilePreviewPage
                    ref={filePreviewRef}
                    file={previewFile}
                    readOnly={!previewEditable}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <FilePreviewPage ref={filePreviewRef} file={previewFile} readOnly={!previewEditable} />
        )}
      </div>

      {popup && <SelectionPopup x={popup.x} y={popup.y} onAdd={handleAddToChat} />}
    </div>
  );
};

export default CanvasFilePreviewPane;
