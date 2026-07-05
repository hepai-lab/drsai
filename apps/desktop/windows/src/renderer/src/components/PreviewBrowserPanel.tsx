import {
  Bookmark,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  Crosshair,
  FileText,
  Globe2,
  Keyboard,
  Loader2,
  MousePointerClick,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Square,
  Type,
  X,
} from "lucide-react";
import { Component, FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ChatAttachment } from "@shared/desktopApi";
import type { AppLanguage } from "../navigation";
import { desktopApi } from "../desktopApi";

interface PreviewBrowserPanelProps {
  initialUrl?: string;
  language: AppLanguage;
  onAttachContext: (attachment: ChatAttachment) => void;
  onClose: () => void;
}

interface BrowserPanelErrorBoundaryProps {
  children: ReactNode;
}

interface BrowserPanelErrorBoundaryState {
  error: string | null;
}

interface BrowserTab {
  id: string;
  title: string;
  url: string;
  draftUrl: string;
  loading: boolean;
}

interface BrowserHistoryItem {
  url: string;
  title: string;
  visitedAt: string;
}

interface BrowserBookmark {
  url: string;
  title: string;
  createdAt: string;
}

interface PageSnapshot {
  title: string;
  url: string;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  visibleText: string;
  structure: {
    headings: string[];
    buttons: string[];
    links: string[];
    inputs: string[];
    elements: Array<{
      selector: string;
      tag: string;
      role: string;
      text: string;
      rect: { x: number; y: number; width: number; height: number };
      styles: {
        display: string;
        visibility: string;
        color: string;
        backgroundColor: string;
        fontSize: string;
      };
    }>;
  };
  resources: Array<{ name: string; type: string; duration: number }>;
}

type BrowserActionMode =
  | "click"
  | "type"
  | "select"
  | "key_press"
  | "wait_for"
  | "assert_text";

const DEFAULT_URL = "http://localhost:3000/";
const STORAGE_KEY = "opendrsai.previewBrowser.state";
const MAX_HISTORY = 80;

const READ_TEXT_SCRIPT = [
  "(() => {",
  '  const text = document.body?.innerText || "";',
  '  return text.replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, 12000);',
  "})()",
].join("\n");

const SNAPSHOT_SCRIPT = [
  "(() => {",
  "  const textOf = (node) => (node?.innerText || node?.textContent || node?.getAttribute?.('aria-label') || '').trim();",
  "  const cssEscape = (value) => window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/\"/g, '\\\\\"');",
  "  const selectorFor = (node) => {",
  "    if (node.id) return '#' + cssEscape(node.id);",
  "    const name = node.getAttribute('name');",
  "    if (name) return node.tagName.toLowerCase() + '[name=\"' + cssEscape(name) + '\"]';",
  "    const label = node.getAttribute('aria-label');",
  "    if (label) return node.tagName.toLowerCase() + '[aria-label=\"' + cssEscape(label) + '\"]';",
  "    const parts = [];",
  "    let current = node;",
  "    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {",
  "      const parent = current.parentElement;",
  "      const tag = current.tagName.toLowerCase();",
  "      if (!parent) { parts.unshift(tag); break; }",
  "      const index = Array.from(parent.children).filter((item) => item.tagName === current.tagName).indexOf(current) + 1;",
  "      parts.unshift(tag + ':nth-of-type(' + index + ')');",
  "      current = parent;",
  "    }",
  "    return parts.join(' > ');",
  "  };",
  "  const values = (selector) => Array.from(document.querySelectorAll(selector)).map(textOf).filter(Boolean).slice(0, 60);",
  "  const elements = Array.from(document.querySelectorAll('a[href],button,[role=button],input,textarea,select,[contenteditable=true],h1,h2,h3')).slice(0, 80).map((node) => {",
  "    const rect = node.getBoundingClientRect();",
  "    const style = getComputedStyle(node);",
  "    return { selector: selectorFor(node), tag: node.tagName.toLowerCase(), role: node.getAttribute('role') || node.getAttribute('type') || '', text: textOf(node).slice(0, 180), rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, styles: { display: style.display, visibility: style.visibility, color: style.color, backgroundColor: style.backgroundColor, fontSize: style.fontSize } };",
  "  });",
  "  return {",
  "    title: document.title || '',",
  "    url: location.href,",
  "    viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },",
  "    visibleText: (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 16000),",
  "    structure: {",
  "      headings: values('h1,h2,h3,[role=heading]'),",
  "      buttons: values('button,[role=button]'),",
  "      links: Array.from(document.querySelectorAll('a[href]')).map((node) => { const label = textOf(node); const href = node.getAttribute('href') || ''; return label ? label + ' (' + href + ')' : href; }).filter(Boolean).slice(0, 60),",
  "      inputs: Array.from(document.querySelectorAll('input,textarea,select,[contenteditable=true]')).map((node) => { const label = node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.getAttribute('name') || node.id || node.tagName.toLowerCase(); const type = node.getAttribute('type') || node.tagName.toLowerCase(); return label + ' [' + type + '] ' + selectorFor(node); }).filter(Boolean).slice(0, 60),",
  "      elements,",
  "    },",
  "    resources: performance.getEntriesByType('resource').slice(-40).map((item) => ({ name: item.name, type: item.initiatorType || 'resource', duration: Math.round(item.duration) })),",
  "  };",
  "})()",
].join("\n");

const PICK_ELEMENT_SCRIPT = [
  "new Promise((resolve) => {",
  "  const previous = { outline: null, node: null };",
  "  const cssEscape = (value) => window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/\"/g, '\\\\\"');",
  "  const selectorFor = (node) => {",
  "    if (node.id) return '#' + cssEscape(node.id);",
  "    const name = node.getAttribute('name');",
  "    if (name) return node.tagName.toLowerCase() + '[name=\"' + cssEscape(name) + '\"]';",
  "    const label = node.getAttribute('aria-label');",
  "    if (label) return node.tagName.toLowerCase() + '[aria-label=\"' + cssEscape(label) + '\"]';",
  "    const parts = [];",
  "    let current = node;",
  "    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {",
  "      const parent = current.parentElement;",
  "      const tag = current.tagName.toLowerCase();",
  "      if (!parent) { parts.unshift(tag); break; }",
  "      const index = Array.from(parent.children).filter((item) => item.tagName === current.tagName).indexOf(current) + 1;",
  "      parts.unshift(tag + ':nth-of-type(' + index + ')');",
  "      current = parent;",
  "    }",
  "    return parts.join(' > ');",
  "  };",
  "  const cleanup = () => { document.removeEventListener('mouseover', over, true); document.removeEventListener('click', click, true); if (previous.node) previous.node.style.outline = previous.outline || ''; };",
  "  const over = (event) => { const node = event.target; if (previous.node && previous.node !== node) previous.node.style.outline = previous.outline || ''; previous.node = node; previous.outline = node.style.outline; node.style.outline = '2px solid #8b5cf6'; };",
  "  const click = (event) => { event.preventDefault(); event.stopPropagation(); const selector = selectorFor(event.target); cleanup(); resolve(selector); };",
  "  document.addEventListener('mouseover', over, true);",
  "  document.addEventListener('click', click, true);",
  "  setTimeout(() => { cleanup(); resolve(''); }, 15000);",
  "})",
].join("\n");

export function PreviewBrowserPanel({
  initialUrl,
  language,
  onAttachContext,
  onClose,
}: PreviewBrowserPanelProps): React.JSX.Element {
  return (
    <BrowserPanelErrorBoundary>
      <PreviewBrowserPanelContent
        initialUrl={initialUrl}
        language={language}
        onAttachContext={onAttachContext}
        onClose={onClose}
      />
    </BrowserPanelErrorBoundary>
  );
}

function PreviewBrowserPanelContent({
  initialUrl,
  language,
  onAttachContext,
  onClose,
}: PreviewBrowserPanelProps): React.JSX.Element {
  const isZh = language === "zh";
  const webviewRefs = useRef(new Map<string, OpenDrSaiWebviewTag>());
  const webviewRefCallbacks = useRef(new Map<string, (node: OpenDrSaiWebviewTag | null) => void>());
  const stagedInitialUrlRef = useRef<string | undefined>(undefined);
  const initialState = useRef(loadState()).current;
  const [tabs, setTabs] = useState<BrowserTab[]>(initialState.tabs);
  const [activeTabId, setActiveTabId] = useState(initialState.activeTabId);
  const [history, setHistory] = useState<BrowserHistoryItem[]>(initialState.history);
  const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>(initialState.bookmarks);
  const [status, setStatus] = useState("Open a local or HTTPS page.");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [attachedCount, setAttachedCount] = useState(0);
  const [showLibrary, setShowLibrary] = useState<"history" | "bookmarks" | null>(null);
  const [consoleMessages, setConsoleMessages] = useState<string[]>([]);
  const [networkEvents, setNetworkEvents] = useState<string[]>([]);
  const [actionSelector, setActionSelector] = useState("");
  const [actionText, setActionText] = useState("");
  const [actionKey, setActionKey] = useState("Enter");
  const [actionLog, setActionLog] = useState<string[]>([]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const statusTone = status.toLowerCase().includes("blocked") || status.toLowerCase().includes("not allowed") ? "warning" : "normal";
  const bookmarked = Boolean(activeTab?.url && bookmarks.some((item) => item.url === activeTab.url));

  const setTab = useCallback((id: string, update: Partial<BrowserTab>) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...update } : tab)));
  }, []);

  const activeWebview = useCallback((): OpenDrSaiWebviewTag | undefined => {
    return activeTab ? webviewRefs.current.get(activeTab.id) : undefined;
  }, [activeTab]);

  const refreshNavigationState = useCallback((): void => {
    const webview = activeWebview();
    setCanGoBack(Boolean(webview?.canGoBack()));
    setCanGoForward(Boolean(webview?.canGoForward()));
  }, [activeWebview]);

  useEffect(() => {
    if (!initialUrl) return;
    if (stagedInitialUrlRef.current === initialUrl) return;
    stagedInitialUrlRef.current = initialUrl;
    stageUrl(initialUrl);
  }, [initialUrl]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tabs, activeTabId, history, bookmarks }),
    );
  }, [tabs, activeTabId, history, bookmarks]);

  useEffect(() => {
    refreshNavigationState();
  }, [activeTabId, tabs.length, refreshNavigationState]);

  function bindWebview(tabId: string): (node: OpenDrSaiWebviewTag | null) => void {
    const existing = webviewRefCallbacks.current.get(tabId);
    if (existing) return existing;
    const callback = (node: OpenDrSaiWebviewTag | null): void => {
      if (!node) {
        webviewRefs.current.delete(tabId);
        return;
      }
      if (webviewRefs.current.get(tabId) === node) return;
      webviewRefs.current.set(tabId, node);
      node.addEventListener("did-start-loading", () => {
        setTab(tabId, { loading: true });
        setStatus("Loading page...");
      });
      node.addEventListener("did-stop-loading", () => {
        const url = node.getURL();
        const title = node.getTitle();
        setTab(tabId, { loading: false, url, draftUrl: url || DEFAULT_URL, title });
        rememberHistory(url, title);
        refreshNavigationState();
        setStatus("Page ready.");
      });
      const updateTitle = (): void => {
        const url = node.getURL();
        setTab(tabId, { url, draftUrl: url || DEFAULT_URL, title: node.getTitle() || url });
        refreshNavigationState();
      };
      node.addEventListener("did-navigate", updateTitle);
      node.addEventListener("did-navigate-in-page", updateTitle);
      node.addEventListener("page-title-updated", updateTitle);
      node.addEventListener("did-fail-load", (event) => {
        const detail = event as Event & { errorCode?: number; errorDescription?: string; validatedURL?: string };
        const message = `${detail.errorCode ?? ""} ${detail.errorDescription ?? "Load failed"} ${detail.validatedURL ?? ""}`.trim();
        setNetworkEvents((current) => [message, ...current].slice(0, 30));
        setStatus(message);
        setTab(tabId, { loading: false });
      });
      node.addEventListener("render-process-gone", (event) => {
        const detail = event as Event & { reason?: string; exitCode?: number };
        const message = `Browser preview process stopped${detail.reason ? `: ${detail.reason}` : ""}${typeof detail.exitCode === "number" ? ` (${detail.exitCode})` : ""}.`;
        setNetworkEvents((current) => [message, ...current].slice(0, 30));
        setStatus(message);
        setTab(tabId, { url: "", loading: false });
      });
      node.addEventListener("unresponsive", () => {
        const message = "Browser preview became unresponsive.";
        setNetworkEvents((current) => [message, ...current].slice(0, 30));
        setStatus(message);
        setTab(tabId, { loading: false });
      });
      node.addEventListener("console-message", (event) => {
        const detail = event as Event & { message?: string; line?: number; sourceId?: string };
        const message = `${detail.message ?? "console message"}${detail.sourceId ? ` (${detail.sourceId}:${detail.line ?? 0})` : ""}`;
        setConsoleMessages((current) => [message, ...current].slice(0, 30));
      });
    };
    webviewRefCallbacks.current.set(tabId, callback);
    return callback;
  }

  function stageUrl(rawUrl: string, tabId = activeTab?.id): void {
    if (!tabId) return;
    const candidate = normalizeUrlInput(rawUrl);
    setTab(tabId, {
      draftUrl: candidate,
      title: candidate,
      url: "",
      loading: false,
    });
    setStatus("Link staged. Click Open to load it in the preview browser.");
  }

  async function navigate(rawUrl: string, tabId = activeTab?.id): Promise<void> {
    if (!tabId) return;
    const candidate = normalizeUrlInput(rawUrl);
    const check = await desktopApi.checkBrowserUrl(candidate);
    if (!check.allowed || !check.normalizedUrl) {
      setStatus(check.reason);
      return;
    }
    const openResult = await desktopApi.requestBrowserAction({
      action: "open",
      url: check.normalizedUrl,
    });
    if (!openResult.ok) {
      setStatus(openResult.message);
      return;
    }
    setTab(tabId, {
      draftUrl: check.normalizedUrl,
      url: check.normalizedUrl,
      title: check.normalizedUrl,
      loading: true,
    });
    setStatus("Opening page...");
  }

  function submitUrl(event: FormEvent): void {
    event.preventDefault();
    if (activeTab) void navigate(activeTab.draftUrl, activeTab.id);
  }

  function addTab(url = DEFAULT_URL): void {
    const tab = createTab(url, "");
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(tabId: string): void {
    setTabs((current) => {
      const next = current.length > 1 ? current.filter((tab) => tab.id !== tabId) : [createTab(DEFAULT_URL, "")];
      if (tabId === activeTabId) setActiveTabId(next[0].id);
      return next;
    });
  }

  function rememberHistory(url: string, title: string): void {
    if (!url) return;
    setHistory((current) => [
      { url, title: title || url, visitedAt: new Date().toISOString() },
      ...current.filter((item) => item.url !== url),
    ].slice(0, MAX_HISTORY));
  }

  function toggleBookmark(): void {
    if (!activeTab?.url) return;
    setBookmarks((current) => {
      if (current.some((item) => item.url === activeTab.url)) {
        return current.filter((item) => item.url !== activeTab.url);
      }
      return [
        { url: activeTab.url, title: activeTab.title || activeTab.url, createdAt: new Date().toISOString() },
        ...current,
      ];
    });
  }

  async function readSnapshot(): Promise<PageSnapshot> {
    const webview = activeWebview();
    if (!webview) throw new Error("Browser preview is not ready.");
    await desktopApi.requestBrowserAction({ action: "snapshot" });
    return webview.executeJavaScript<PageSnapshot>(SNAPSHOT_SCRIPT, false);
  }

  async function attachContext(mode: "summary" | "screenshot"): Promise<void> {
    try {
      const snapshot = await readSnapshot();
      let screenshotDataUrl: string | undefined;
      if (mode === "screenshot") {
        await desktopApi.requestBrowserAction({ action: "screenshot" });
        screenshotDataUrl = (await activeWebview()?.capturePage())?.toDataURL();
      } else {
        await desktopApi.requestBrowserAction({ action: "read_text" });
      }
      const structure = [
        `Viewport: ${snapshot.viewport.width}x${snapshot.viewport.height} scroll(${snapshot.viewport.scrollX}, ${snapshot.viewport.scrollY})`,
        snapshot.structure.headings.length ? `Headings: ${snapshot.structure.headings.join(" | ")}` : "",
        snapshot.structure.buttons.length ? `Buttons: ${snapshot.structure.buttons.join(" | ")}` : "",
        snapshot.structure.inputs.length ? `Inputs: ${snapshot.structure.inputs.join(" | ")}` : "",
        snapshot.structure.links.length ? `Links: ${snapshot.structure.links.join(" | ")}` : "",
        snapshot.structure.elements.length
          ? `Interactive elements:\n${snapshot.structure.elements.map((item) => `${item.selector} ${item.tag} ${item.role} rect=${item.rect.x},${item.rect.y},${item.rect.width},${item.rect.height} text=${item.text}`).join("\n")}`
          : "",
        snapshot.resources.length
          ? `Recent resources:\n${snapshot.resources.map((item) => `${item.type} ${item.duration}ms ${item.name}`).join("\n")}`
          : "",
        consoleMessages.length ? `Console:\n${consoleMessages.join("\n")}` : "",
        networkEvents.length ? `Network/load issues:\n${networkEvents.join("\n")}` : "",
        screenshotDataUrl ? `Screenshot: data URL captured (${screenshotDataUrl.length} chars).` : "",
      ].filter(Boolean).join("\n");

      onAttachContext({
        kind: "browser",
        path: snapshot.url,
        name: snapshot.title || snapshot.url,
        url: snapshot.url,
        title: snapshot.title,
        visibleText: `${snapshot.visibleText}\n\n${structure}`.trim(),
        screenshotDataUrl,
        note: mode === "screenshot" ? "Screenshot captured from Preview Browser." : "Page context captured from Preview Browser.",
      });
      setAttachedCount((count) => count + 1);
      setStatus("Browser context added to the next message.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function runReadonlyCheck(): Promise<void> {
    try {
      const result = await desktopApi.requestBrowserAction({ action: "eval_readonly", script: READ_TEXT_SCRIPT });
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      const visibleText = await activeWebview()?.executeJavaScript<string>(READ_TEXT_SCRIPT, false);
      setStatus(
        visibleText
          ? `Read-only check complete: ${visibleText.length} characters.`
          : "Read-only check complete: no visible text.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function pickElement(): Promise<void> {
    try {
      setStatus("Click an element in the page to generate a selector.");
      const selector = await activeWebview()?.executeJavaScript<string>(PICK_ELEMENT_SCRIPT, true);
      if (selector) {
        setActionSelector(selector);
        setStatus(`Selected: ${selector}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function runControlledAction(mode: BrowserActionMode): Promise<void> {
    const selector = actionSelector.trim();
    const text = actionText;
    if (!selector && mode !== "assert_text") {
      setStatus("Enter a CSS selector.");
      return;
    }
    if ((mode === "type" || mode === "select" || mode === "assert_text") && !text) {
      setStatus("Enter text or value.");
      return;
    }
    const needsApproval = mode === "click" || mode === "type" || mode === "select" || mode === "key_press";
    if (needsApproval) {
      const ok = window.confirm(`Allow browser action: ${mode} ${selector || actionKey}?`);
      if (!ok) {
        setStatus("Controlled action cancelled.");
        return;
      }
    }
    try {
      const approval = await desktopApi.requestBrowserAction({
        action: mode,
        selector,
        text,
        key: actionKey,
        approved: needsApproval,
      });
      if (!approval.ok) {
        setStatus(approval.message);
        return;
      }
      const script = createActionScript(mode, selector, text, actionKey);
      const executed = await activeWebview()?.executeJavaScript<string>(script, needsApproval);
      const message = executed || approval.message;
      setActionLog((current) => [`${new Date().toLocaleTimeString()} ${mode}: ${message}`, ...current].slice(0, 12));
      setStatus(message);
      refreshNavigationState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <aside className="preview-browser-panel" aria-label={isZh ? "Preview Browser" : "Preview Browser"}>
      <div className="preview-browser-header">
        <div>
          <h2>Browser</h2>
          <p>{activeTab?.title || activeTab?.draftUrl || "Local and HTTPS page preview"}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Browser" title="Close">
          <X size={16} />
        </button>
      </div>

      <div className="preview-browser-tabs">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" className={tab.id === activeTabId ? "active" : ""} onClick={() => setActiveTabId(tab.id)} title={tab.url || tab.draftUrl}>
            {tab.loading && <Loader2 size={12} className="spin" />}
            <span>{tab.title || tab.draftUrl || "New tab"}</span>
            <X size={12} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }} />
          </button>
        ))}
        <button type="button" className="new-tab" onClick={() => addTab()} aria-label="New tab" title="New tab">
          <Plus size={14} />
        </button>
      </div>

      <form className="preview-browser-toolbar" onSubmit={submitUrl}>
        <button type="button" disabled={!canGoBack} onClick={() => activeWebview()?.goBack()} title="Back" aria-label="Back">
          <ChevronLeft size={16} />
        </button>
        <button type="button" disabled={!canGoForward} onClick={() => activeWebview()?.goForward()} title="Forward" aria-label="Forward">
          <ChevronRight size={16} />
        </button>
        <button type="button" onClick={() => (activeTab?.loading ? activeWebview()?.stop() : activeWebview()?.reload())} title={activeTab?.loading ? "Stop" : "Reload"} aria-label={activeTab?.loading ? "Stop" : "Reload"}>
          {activeTab?.loading ? <Square size={14} /> : <RefreshCw size={15} />}
        </button>
        <div className="preview-browser-address">
          <Globe2 size={15} />
          <input value={activeTab?.draftUrl ?? ""} onChange={(event) => activeTab && setTab(activeTab.id, { draftUrl: event.target.value })} placeholder="https://example.com or http://localhost:3000/" />
        </div>
        <button type="submit" className="preview-browser-go">
          {activeTab?.loading ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          Open
        </button>
      </form>

      <div className={`preview-browser-status ${statusTone}`}>
        {statusTone === "warning" ? <ShieldAlert size={14} /> : <Code2 size={14} />}
        <span>{status}</span>
        {attachedCount > 0 && <strong>{attachedCount}</strong>}
      </div>

      <div className="preview-browser-actions">
        <button type="button" onClick={() => void attachContext("summary")} disabled={!activeTab?.url}><FileText size={15} />Attach Context</button>
        <button type="button" onClick={() => void attachContext("screenshot")} disabled={!activeTab?.url}><Camera size={15} />Attach Screenshot</button>
        <button type="button" onClick={() => void runReadonlyCheck()} disabled={!activeTab?.url}><MousePointerClick size={15} />Read-only Check</button>
        <button type="button" onClick={toggleBookmark} disabled={!activeTab?.url}><Bookmark size={15} />{bookmarked ? "Unbookmark" : "Bookmark"}</button>
        <button type="button" onClick={() => setShowLibrary(showLibrary === "history" ? null : "history")}><Clock size={15} />History</button>
        <button type="button" onClick={() => setShowLibrary(showLibrary === "bookmarks" ? null : "bookmarks")}><Bookmark size={15} />Bookmarks</button>
      </div>

      {showLibrary && (
        <div className="preview-browser-library">
          {(showLibrary === "history" ? history : bookmarks).map((item) => (
            <button key={`${item.url}-${"visitedAt" in item ? item.visitedAt : item.createdAt}`} type="button" onClick={() => void navigate(item.url)}>
              <strong>{item.title || item.url}</strong>
              <span>{item.url}</span>
            </button>
          ))}
        </div>
      )}

      <div className="preview-browser-control">
        <input value={actionSelector} onChange={(event) => setActionSelector(event.target.value)} placeholder="CSS selector" disabled={!activeTab?.url} />
        <input value={actionText} onChange={(event) => setActionText(event.target.value)} placeholder="Text / value / assertion" disabled={!activeTab?.url} />
        <input value={actionKey} onChange={(event) => setActionKey(event.target.value)} placeholder="Enter" disabled={!activeTab?.url} />
        <button type="button" onClick={() => void pickElement()} disabled={!activeTab?.url}><Crosshair size={15} />Pick</button>
        <button type="button" onClick={() => void runControlledAction("click")} disabled={!activeTab?.url}><MousePointerClick size={15} />Click</button>
        <button type="button" onClick={() => void runControlledAction("type")} disabled={!activeTab?.url}><Type size={15} />Type</button>
        <button type="button" onClick={() => void runControlledAction("select")} disabled={!activeTab?.url}><Send size={15} />Select</button>
        <button type="button" onClick={() => void runControlledAction("key_press")} disabled={!activeTab?.url}><Keyboard size={15} />Key</button>
        <button type="button" onClick={() => void runControlledAction("wait_for")} disabled={!activeTab?.url}><Clock size={15} />Wait</button>
        <button type="button" onClick={() => void runControlledAction("assert_text")} disabled={!activeTab?.url}><Code2 size={15} />Assert</button>
      </div>

      {actionLog.length > 0 && <div className="preview-browser-action-log">{actionLog.map((item) => <span key={item}>{item}</span>)}</div>}

      <div className="preview-browser-surface">
        {tabs.map((tab) =>
          tab.url ? (
            <webview key={tab.id} ref={bindWebview(tab.id)} src={tab.url} partition="persist:opendrsai-preview" webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes" style={{ display: tab.id === activeTabId ? "flex" : "none" }} />
          ) : null,
        )}
        {!activeTab?.url && (
          <div className="preview-browser-empty">
            <Globe2 size={28} />
            <h3>Enter a URL and click Open</h3>
            <p>The Browser tab does not auto-load pages on open, avoiding a blank panel when local servers are not running.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function createTab(draftUrl: string, url = ""): BrowserTab {
  return { id: crypto.randomUUID(), title: draftUrl, url, draftUrl, loading: false };
}

function loadState(): { tabs: BrowserTab[]; activeTabId: string; history: BrowserHistoryItem[]; bookmarks: BrowserBookmark[] } {
  const fallbackTab = createTab(DEFAULT_URL, "");
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as Partial<{
      tabs: BrowserTab[];
      activeTabId: string;
      history: BrowserHistoryItem[];
      bookmarks: BrowserBookmark[];
    }>;
    const tabs = Array.isArray(parsed.tabs) && parsed.tabs.length
      ? parsed.tabs.map((tab) => ({
          ...tab,
          draftUrl: tab.draftUrl || tab.url || DEFAULT_URL,
          title: tab.title || tab.draftUrl || tab.url || DEFAULT_URL,
          url: "",
          loading: false,
        }))
      : [fallbackTab];
    return {
      tabs,
      activeTabId: parsed.activeTabId && tabs.some((tab) => tab.id === parsed.activeTabId) ? parsed.activeTabId : tabs[0].id,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
    };
  } catch {
    return { tabs: [fallbackTab], activeTabId: fallbackTab.id, history: [], bookmarks: [] };
  }
}

function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_URL;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1") || trimmed.startsWith("[::1]") || trimmed.startsWith("::1")) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

function createActionScript(mode: BrowserActionMode, selector: string, text: string, key: string): string {
  return [
    "(() => {",
    `  const mode = ${JSON.stringify(mode)};`,
    `  const selector = ${JSON.stringify(selector)};`,
    `  const text = ${JSON.stringify(text)};`,
    `  const key = ${JSON.stringify(key)};`,
    "  const find = () => selector ? document.querySelector(selector) : null;",
    "  if (mode === 'assert_text') { const source = selector ? (find()?.innerText || find()?.textContent || '') : (document.body?.innerText || ''); return source.includes(text) ? 'Assertion passed.' : 'Assertion failed: text not found.'; }",
    "  if (mode === 'wait_for') { const start = Date.now(); return new Promise((resolve) => { const tick = () => { if (find()) { resolve('Wait complete: selector found.'); return; } if (Date.now() - start > 5000) { resolve('Wait timed out: selector not found.'); return; } setTimeout(tick, 100); }; tick(); }); }",
    "  const node = find();",
    "  if (!node) return 'No element matched the selector.';",
    "  node.scrollIntoView({ block: 'center', inline: 'center' });",
    "  node.focus();",
    "  if (mode === 'click') { const rect = node.getBoundingClientRect(); const options = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }; node.dispatchEvent(new PointerEvent('pointerdown', options)); node.dispatchEvent(new MouseEvent('mousedown', options)); node.dispatchEvent(new PointerEvent('pointerup', options)); node.dispatchEvent(new MouseEvent('mouseup', options)); node.click(); return 'Approved click executed.'; }",
    "  if (mode === 'type') { if ('value' in node) node.value = text; else if (node.isContentEditable) node.textContent = text; else return 'Matched element is not editable.'; node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); node.dispatchEvent(new Event('change', { bubbles: true })); return 'Approved type action executed.'; }",
    "  if (mode === 'select') { if (!('value' in node)) return 'Matched element is not selectable.'; node.value = text; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); return 'Approved select action executed.'; }",
    "  if (mode === 'key_press') { node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true })); return 'Approved key action executed.'; }",
    "  return 'Unsupported action.';",
    "})()",
  ].join("\n");
}

class BrowserPanelErrorBoundary extends Component<
  BrowserPanelErrorBoundaryProps,
  BrowserPanelErrorBoundaryState
> {
  state: BrowserPanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BrowserPanelErrorBoundaryState {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  override componentDidCatch(error: unknown): void {
    console.error("Preview Browser panel failed", error);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <aside className="preview-browser-panel" aria-label="Preview Browser">
        <div className="preview-browser-header">
          <div>
            <h2>Browser</h2>
            <p>Preview panel recovered from an error.</p>
          </div>
        </div>
        <div className="preview-browser-status warning">
          <ShieldAlert size={14} />
          <span>{this.state.error}</span>
        </div>
        <div className="preview-browser-empty">
          <Globe2 size={28} />
          <h3>Browser panel paused</h3>
          <p>Close and reopen the Browser tab after fixing the page or URL that caused the failure.</p>
        </div>
      </aside>
    );
  }
}
