import { useEffect, useMemo, useState } from "react";
import { Bug, CheckCircle2, ChevronDown, ChevronUp, Lightbulb, Loader2, MessageSquareWarning, MousePointer2, Paperclip, Sparkles, X } from "lucide-react";
import type { FeedbackCategory, FeedbackContext, FeedbackDraft, FeedbackPackagePreview, FeedbackSubmitResult, PendingFeedbackItem } from "@shared/feedback";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";

export interface FeedbackDialogProps {
  language: AppLanguage;
  context: Partial<FeedbackContext>;
  initialCategory?: FeedbackCategory;
  initialSource?: FeedbackDraft["source"];
  onSubmitted?(result: FeedbackSubmitResult): void;
  onClose(): void;
}

const categories: Array<{ id: FeedbackCategory; zh: string; en: string; icon: typeof Bug }> = [
  { id: "bug", zh: "出错了", en: "Something broke", icon: Bug },
  { id: "usability", zh: "不好用", en: "Hard to use", icon: MousePointer2 },
  { id: "suggestion", zh: "有建议", en: "Suggestion", icon: Lightbulb },
  { id: "feature_request", zh: "想要新功能", en: "Feature request", icon: Sparkles },
];

export function FeedbackDialog({ language, context, initialCategory = "bug", initialSource = "global", onSubmitted, onClose }: FeedbackDialogProps): React.JSX.Element {
  const zh = language === "zh";
  const [category, setCategory] = useState<FeedbackCategory>(initialCategory);
  const [description, setDescription] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [includeDetailedLogs, setIncludeDetailedLogs] = useState(false);
  const [includeScreenshot, setIncludeScreenshot] = useState(false);
  const [screenshot, setScreenshot] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [redactions, setRedactions] = useState<Array<{ x: number; y: number; width: number; height: number }>>([]);
  const [drawing, setDrawing] = useState<{ x: number; y: number; currentX: number; currentY: number } | null>(null);
  const [contactAllowed, setContactAllowed] = useState(false);
  const [contactAddress, setContactAddress] = useState("");
  const [preview, setPreview] = useState<FeedbackPackagePreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<FeedbackSubmitResult | null>(null);
  const [pending, setPending] = useState<PendingFeedbackItem[]>([]);
  const clientFeedbackId = useMemo(() => `desktop-${Date.now()}-${crypto.randomUUID()}`, []);
  const needsDescription = category === "suggestion" || category === "feature_request";

  const draft = async (): Promise<FeedbackDraft> => ({
    client_feedback_id: clientFeedbackId, category, source: initialSource, user_description: description,
    contact_address: contactAllowed ? contactAddress : undefined, context,
    consent: { diagnostics: includeDiagnostics, screenshot: includeScreenshot && screenshot !== null, conversation_context: false, detailed_logs: includeDiagnostics && includeDetailedLogs, contact: contactAllowed },
    screenshot_data_url: includeScreenshot && screenshot ? await renderRedactedScreenshot(screenshot, redactions) : undefined,
  });

  useEffect(() => {
    void desktopApi.listPendingFeedback().then(setPending).catch(() => undefined);
    void draft().then((initial) => desktopApi.previewFeedback(initial)).then(setPreview).catch(() => undefined);
    // The initial preview records the panel-open metric and stays hidden until requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function captureScreenshot(): Promise<void> {
    setBusy(true); setError("");
    const dialog = document.querySelector<HTMLElement>(".feedback-dialog");
    try {
      if (dialog) dialog.style.visibility = "hidden";
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const captured = await desktopApi.captureFeedbackScreenshot();
      setScreenshot({ dataUrl: captured.data_url, width: captured.width, height: captured.height });
      setRedactions([]); setIncludeScreenshot(true); setPreview(null);
    } catch (cause) { setIncludeScreenshot(false); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (dialog) dialog.style.visibility = ""; setBusy(false); }
  }

  async function inspect(): Promise<void> {
    setBusy(true); setError("");
    try { setPreview(await desktopApi.previewFeedback(await draft())); setPreviewOpen(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function submit(): Promise<void> {
    setBusy(true); setError("");
    try { const submitted = await desktopApi.submitFeedback(await draft()); setResult(submitted); onSubmitted?.(submitted); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return <div className="feedback-overlay" role="presentation" onMouseDown={onClose}>
    <section className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title" data-testid="feedback-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><MessageSquareWarning size={20} /><h2 id="feedback-title">{zh ? "反馈与建议" : "Feedback"}</h2></div><button type="button" aria-label={zh ? "关闭" : "Close"} onClick={onClose}><X size={18} /></button></header>
      {result ? <div className="feedback-success" role="status">
        <CheckCircle2 size={34} /><h3>{result.queued ? (zh ? "已安全保存在本机" : "Saved securely on this device") : (zh ? "已收到，谢谢" : "Received, thank you")}</h3>
        {result.feedback_id ? <p>{zh ? "反馈编号" : "Feedback ID"}：<code>{result.feedback_id}</code></p> : null}
        <p>{zh ? (result.queued ? "Runtime 恢复后将自动重试发送。" : "你可以继续使用 OpenDrSai。") : result.message}</p>
        <button type="button" className="primary" onClick={onClose}>{zh ? "继续使用" : "Continue"}</button>
      </div> : <>
        <p className="feedback-intro">{zh ? "你只需告诉我们哪里不对，App 会自动准备经过脱敏的现场信息。" : "Tell us what felt wrong. The app prepares a redacted snapshot automatically."}</p>
        <div className="feedback-categories" role="radiogroup" aria-label={zh ? "反馈类型" : "Feedback type"}>{categories.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" role="radio" aria-checked={category === item.id} className={category === item.id ? "selected" : ""} onClick={() => setCategory(item.id)}><Icon size={17} /><span>{zh ? item.zh : item.en}</span></button>; })}</div>
        <label className="feedback-description"><span>{zh ? `简单说一句${needsDescription ? "" : "（可选）"}` : `In a few words${needsDescription ? "" : " (optional)"}`}</span><textarea value={description} maxLength={8000} rows={4} onChange={(event) => setDescription(event.target.value)} placeholder={zh ? "比如：运行到一半一直卡住" : "For example: the task stays running forever"} /></label>
        <section className="feedback-attachments">
          <div className="feedback-section-title"><Paperclip size={15} /><div><strong>{zh ? "帮助我们定位问题" : "Help us understand the issue"}</strong><span>{zh ? "仅发送你选择的内容，提交前可以预览" : "Only selected items are sent. You can review them first."}</span></div></div>
          <label className="feedback-check"><input type="checkbox" checked={includeDiagnostics} onChange={(event) => { setIncludeDiagnostics(event.target.checked); setPreview(null); }} /><span><strong>{zh ? "安全诊断摘要" : "Safe diagnostic summary"}</strong><small>{zh ? "版本、错误代码和最近操作，不含正文" : "Version, error codes and recent actions — no content"}</small></span></label>
          {includeDiagnostics ? <label className="feedback-check"><input type="checkbox" checked={includeDetailedLogs} onChange={(event) => { setIncludeDetailedLogs(event.target.checked); setPreview(null); }} /><span><strong>{zh ? "详细诊断记录" : "Detailed diagnostic history"}</strong><small>{zh ? "可选，经过脱敏处理" : "Optional and redacted before sending"}</small></span></label> : null}
          <label className="feedback-check"><input type="checkbox" checked={includeScreenshot} onChange={(event) => event.target.checked ? void captureScreenshot() : (setIncludeScreenshot(false), setPreview(null))} /><span><strong>{zh ? "当前窗口截图" : "Current window screenshot"}</strong><small>{zh ? "可在发送前涂抹敏感区域" : "You can mask sensitive areas before sending"}</small></span></label>
        </section>
        {includeScreenshot && screenshot ? <section className="feedback-screenshot-editor">
          <div className="feedback-screenshot-toolbar"><strong>{zh ? "拖拽遮挡敏感区域" : "Drag to hide sensitive areas"}</strong><button type="button" disabled={!redactions.length} onClick={() => { setRedactions([]); setPreview(null); }}>{zh ? "清除遮挡" : "Clear masks"}</button></div>
          <div className="feedback-screenshot-stage"
            onPointerDown={(event) => { const point = normalizedPoint(event); event.currentTarget.setPointerCapture(event.pointerId); setDrawing({ x: point.x, y: point.y, currentX: point.x, currentY: point.y }); }}
            onPointerMove={(event) => { if (!drawing) return; const point = normalizedPoint(event); setDrawing((current) => current ? { ...current, currentX: point.x, currentY: point.y } : null); }}
            onPointerUp={(event) => { if (!drawing) return; const point = normalizedPoint(event); const rectangle = normalizeRectangle(drawing.x, drawing.y, point.x, point.y); if (rectangle.width > .01 && rectangle.height > .01) setRedactions((items) => [...items, rectangle]); setDrawing(null); setPreview(null); }}>
            <img src={screenshot.dataUrl} alt={zh ? "当前窗口截图预览" : "Current window screenshot preview"} draggable={false} />
            {redactions.map((rectangle, index) => <span className="feedback-redaction" key={index} style={rectangleStyle(rectangle)} />)}
            {drawing ? <span className="feedback-redaction drawing" style={rectangleStyle(normalizeRectangle(drawing.x, drawing.y, drawing.currentX, drawing.currentY))} /> : null}
          </div>
        </section> : null}
        <label className="feedback-check feedback-contact-choice"><input type="checkbox" checked={contactAllowed} onChange={(event) => setContactAllowed(event.target.checked)} /><span><strong>{zh ? "需要回复" : "I'd like a reply"}</strong><small>{zh ? "联系方式将单独加密保存" : "Your contact details are stored separately and encrypted"}</small></span></label>
        {contactAllowed ? <label className="feedback-contact"><span>{zh ? "联系方式" : "Contact"}</span><input type="email" value={contactAddress} onChange={(event) => setContactAddress(event.target.value)} placeholder="name@example.com" /></label> : null}
        <button type="button" className="feedback-preview-toggle" onClick={() => preview ? setPreviewOpen((open) => !open) : void inspect()} disabled={busy}>{previewOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}{zh ? "查看将发送的信息" : "Review what will be sent"}</button>
        {previewOpen && preview ? <div className="feedback-preview" data-testid="feedback-preview"><strong>{zh ? "安全摘要" : "Safety summary"}</strong><span>{zh ? "数据类型" : "Data categories"}：{preview.data_categories.join("、")}</span><span>{zh ? "预计大小" : "Estimated size"}：{Math.ceil(preview.estimated_byte_length / 1024)} KB</span><span>{zh ? "已移除敏感项" : "Sensitive matches removed"}：{preview.sensitive_matches_removed}</span><span>{zh ? "保留时间" : "Retention"}：{preview.retention_days} {zh ? "天" : "days"}</span><span>{zh ? "截图" : "Screenshot"}：{preview.includes_screenshot ? (zh ? "包含" : "included") : (zh ? "不包含" : "not included")}</span><span>{zh ? "对话正文" : "Conversation text"}：{preview.includes_conversation_context ? (zh ? "包含" : "included") : (zh ? "不包含" : "not included")}</span></div> : null}
        {error ? <div className="feedback-error" role="alert">{error}</div> : null}
        {pending.length ? <section className="feedback-pending" aria-label={zh ? "待发送反馈" : "Pending feedback"}>
          <strong>{zh ? `待发送反馈（${pending.length}）` : `Pending feedback (${pending.length})`}</strong>
          {pending.map((item) => <div key={item.client_feedback_id}><span>{item.category} · {new Date(item.created_at).toLocaleString()}</span><button type="button" onClick={() => void desktopApi.deletePendingFeedback(item.client_feedback_id).then((deleted) => { if (deleted) setPending((items) => items.filter((candidate) => candidate.client_feedback_id !== item.client_feedback_id)); })}>{zh ? "删除" : "Delete"}</button></div>)}
        </section> : null}
        <footer><button type="button" onClick={onClose}>{zh ? "取消" : "Cancel"}</button><button type="button" className="primary" disabled={busy || (needsDescription && !description.trim()) || (contactAllowed && !contactAddress.trim())} onClick={() => void submit()}>{busy ? <Loader2 className="spin" size={16} /> : null}{zh ? "发送反馈" : "Send feedback"}</button></footer>
      </>}
    </section>
  </div>;
}

function normalizedPoint(event: React.PointerEvent<HTMLElement>): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
}
function normalizeRectangle(x1: number, y1: number, x2: number, y2: number): { x: number; y: number; width: number; height: number } { return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }; }
function rectangleStyle(rectangle: { x: number; y: number; width: number; height: number }): React.CSSProperties { return { left: `${rectangle.x * 100}%`, top: `${rectangle.y * 100}%`, width: `${rectangle.width * 100}%`, height: `${rectangle.height * 100}%` }; }
async function renderRedactedScreenshot(screenshot: { dataUrl: string; width: number; height: number }, redactions: Array<{ x: number; y: number; width: number; height: number }>): Promise<string> {
  const image = new Image(); image.src = screenshot.dataUrl;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Screenshot preview could not be decoded.")); });
  const canvas = document.createElement("canvas"); canvas.width = screenshot.width; canvas.height = screenshot.height;
  const context = canvas.getContext("2d"); if (!context) throw new Error("Screenshot redaction is unavailable.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height); context.fillStyle = "#111111";
  for (const rectangle of redactions) context.fillRect(rectangle.x * canvas.width, rectangle.y * canvas.height, rectangle.width * canvas.width, rectangle.height * canvas.height);
  return canvas.toDataURL("image/png");
}
