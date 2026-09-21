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
  Minus,
  MoreVertical,
  MousePointerClick,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Square,
  Type,
  X,
} from "lucide-react";
import { type CSSProperties, FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { desktopApi } from "../desktopApi";
import { userFacingFailureMessage } from "../userFacingLanguage";
import { BrowserPanelErrorBoundary } from "./previewBrowser/BrowserPanelErrorBoundary";
import { requestAppDecision } from "./AppDecisionDialog";
import { LINK_NAVIGATION_MESSAGE, LINK_NAVIGATION_SCRIPT, PICK_ELEMENT_SCRIPT, READ_TEXT_SCRIPT, SNAPSHOT_SCRIPT, createActionScript } from "./previewBrowser/scripts";
import { DEFAULT_URL, MAX_HISTORY, STORAGE_KEY, createTab, loadState, normalizeUrlInput } from "./previewBrowser/state";
import type { BrowserTaskEvent } from "@shared/desktopApi";
import type {
  BrowserActionMode,
  BrowserBookmark,
  BrowserHistoryItem,
  BrowserTab,
  PageSnapshot,
  PreviewBrowserPanelProps,
} from "./previewBrowser/types";

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
}: PreviewBrowserPanelProps): React.JSX.Element {
  const isZh = language === "zh";
  const webviewRefs = useRef(new Map<string, OpenDrSaiWebviewTag>());
  const webviewRefCallbacks = useRef(new Map<string, (node: OpenDrSaiWebviewTag | null) => void>());
  const webviewReadyRef = useRef(new Set<string>());
  const panelRef = useRef<HTMLElement | null>(null);
  const toolsResizeCleanupRef = useRef<(() => void) | null>(null);
  const stagedInitialUrlRef = useRef<string | undefined>(undefined);
  const initialState = useRef(loadState()).current;
  const activeTabIdRef = useRef<string>(initialState.activeTabId);
  const zoomPercentRef = useRef(100);
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
  const [taskInstruction, setTaskInstruction] = useState("");
  const [browserTaskId, setBrowserTaskId] = useState<string | null>(null);
  const [browserTaskEvents, setBrowserTaskEvents] = useState<BrowserTaskEvent[]>([]);
  const [pendingTaskApprovals, setPendingTaskApprovals] = useState<
    Array<Extract<BrowserTaskEvent, { type: "action.proposed" }>>
  >([]);
  const [taskScreenshotDataUrl, setTaskScreenshotDataUrl] = useState<string | null>(null);
  const [taskResult, setTaskResult] = useState<string | null>(null);
  const [readyTabIds, setReadyTabIds] = useState<Set<string>>(new Set());
  const [toolsHeight, setToolsHeight] = useState(168);
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [zoomPercent, setZoomPercent] = useState(100);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const statusTone = status.toLowerCase().includes("blocked") || status.toLowerCase().includes("not allowed") ? "warning" : "normal";
  const bookmarked = Boolean(activeTab?.url && bookmarks.some((item) => item.url === activeTab.url));

  const setTab = useCallback((id: string, update: Partial<BrowserTab>) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...update } : tab)));
  }, []);

  const activeWebviewReady = Boolean(activeTab && readyTabIds.has(activeTab.id));

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    return () => {
      toolsResizeCleanupRef.current?.();
    };
  }, []);

  function setWebviewReady(tabId: string, ready: boolean): void {
    if (ready) webviewReadyRef.current.add(tabId);
    else webviewReadyRef.current.delete(tabId);
    setReadyTabIds(new Set(webviewReadyRef.current));
  }

  function getReadyActiveWebview(): OpenDrSaiWebviewTag {
    if (!activeTab || !webviewReadyRef.current.has(activeTab.id)) {
      throw new Error("Browser preview is still loading. Wait for the page to be ready.");
    }
    const webview = webviewRefs.current.get(activeTab.id);
    if (!webview) throw new Error("Browser preview is not ready.");
    return webview;
  }

  function runWhenActiveWebviewReady(action: (webview: OpenDrSaiWebviewTag) => void): void {
    try {
      action(getReadyActiveWebview());
    } catch (error) {
      setStatus(userFacingFailureMessage(error, language, "connection"));
    }
  }

  function refreshNavigationStateFor(tabId: string, webview = webviewRefs.current.get(tabId)): void {
    if (tabId !== activeTabIdRef.current || !webviewReadyRef.current.has(tabId)) {
      setCanGoBack(false);
      setCanGoForward(false);
      return;
    }
    try {
      setCanGoBack(Boolean(webview?.canGoBack()));
      setCanGoForward(Boolean(webview?.canGoForward()));
    } catch {
      setCanGoBack(false);
      setCanGoForward(false);
    }
  }

  const refreshNavigationState = useCallback((): void => {
    const tabId = activeTabIdRef.current;
    refreshNavigationStateFor(tabId);
  }, [activeTab]);

  function completeWebviewLoad(tabId: string, node: OpenDrSaiWebviewTag, options: { ready: boolean }): void {
    if (options.ready) setWebviewReady(tabId, true);
    const url = node.getURL();
    const title = node.getTitle();
    if (url) rememberHistory(url, title);
    setTab(tabId, {
      loading: false,
      url,
      draftUrl: url || DEFAULT_URL,
      title: title || url || DEFAULT_URL,
    });
    installLinkNavigationRouter(tabId, node);
    void applyBrowserZoom(node, zoomPercentRef.current);
    refreshNavigationStateFor(tabId, node);
    if (tabId === activeTabIdRef.current) setStatus("");
  }

  function installLinkNavigationRouter(tabId: string, node: OpenDrSaiWebviewTag): void {
    node.executeJavaScript(LINK_NAVIGATION_SCRIPT, false).catch((error: unknown) => {
      const message = userFacingFailureMessage(error, language, "connection");
      setNetworkEvents((current) => [message, ...current].slice(0, 30));
      if (tabId === activeTabIdRef.current) setStatus(message);
    });
  }

  function runBrowserNavigation(action: "back" | "forward" | "reload" | "stop"): void {
    runWhenActiveWebviewReady((webview) => {
      if (!activeTab) return;
      if (action === "back") webview.goBack();
      if (action === "forward") webview.goForward();
      if (action === "reload") webview.reload();
      if (action === "stop") webview.stop();
      setTab(activeTab.id, { loading: action !== "stop" });
      setStatus(action === "stop" ? "" : "Loading page...");
      window.setTimeout(() => refreshNavigationStateFor(activeTab.id, webview), 120);
    });
  }

  function setBrowserZoom(nextPercent: number): void {
    const normalized = Math.min(200, Math.max(25, nextPercent));
    runWhenActiveWebviewReady((webview) => {
      zoomPercentRef.current = normalized;
      setZoomPercent(normalized);
      void applyBrowserZoom(webview, normalized);
    });
  }

  async function applyBrowserZoom(webview: OpenDrSaiWebviewTag, percent: number): Promise<void> {
    const factor = percent / 100;
    const zoomLevel = Math.log(factor) / Math.log(1.2);
    const zoomValue = `${percent}%`;
    try {
      await Promise.resolve(webview.setZoomFactor(factor));
      await Promise.resolve(webview.setZoomLevel(zoomLevel));
      await webview.executeJavaScript(
        [
          "(() => {",
          `  const value = ${JSON.stringify(zoomValue)};`,
          "  document.documentElement.style.zoom = value;",
          "  document.body.style.zoom = '';",
          "  return value;",
          "})()",
        ].join("\n"),
        false,
      );
      setStatus(`Zoom ${percent}%`);
    } catch (error) {
      setStatus(userFacingFailureMessage(error, language, "operation"));
    }
  }

  function forceReload(): void {
    runWhenActiveWebviewReady((webview) => {
      webview.reloadIgnoringCache();
      if (activeTab) setTab(activeTab.id, { loading: true });
      setStatus("Force reloading page...");
      setBrowserMenuOpen(false);
    });
  }

  function clearBrowsingData(): void {
    setHistory([]);
    setBookmarks([]);
    runWhenActiveWebviewReady((webview) => {
      webview.clearHistory();
      void webview.executeJavaScript("localStorage.clear(); sessionStorage.clear();", false);
    });
    setStatus("Browsing data cleared.");
    setBrowserMenuOpen(false);
  }

  function showBrowserDevTools(): void {
    runWhenActiveWebviewReady((webview) => {
      webview.openDevTools();
      setStatus("Device tools opened.");
      setBrowserMenuOpen(false);
    });
  }

  function runFindInPage(): void {
    const query = findQuery.trim();
    if (!query) return;
    runWhenActiveWebviewReady((webview) => {
      webview.findInPage(query);
      setStatus(`Finding "${query}"`);
    });
  }

  function closeFindInPage(): void {
    runWhenActiveWebviewReady((webview) => {
      webview.stopFindInPage("clearSelection");
    });
    setFindOpen(false);
    setFindQuery("");
  }

  async function openInNewTab(rawUrl: string): Promise<void> {
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
    const tab = createTab(check.normalizedUrl, check.normalizedUrl);
    tab.loading = true;
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setStatus("Opening page in new tab...");
  }

  function handleLinkNavigationMessage(message: string): boolean {
    if (!message.startsWith(LINK_NAVIGATION_MESSAGE)) return false;
    try {
      const payload = JSON.parse(message.slice(LINK_NAVIGATION_MESSAGE.length)) as {
        url?: unknown;
        disposition?: unknown;
      };
      if (payload.disposition === "new-tab" && typeof payload.url === "string") {
        void openInNewTab(payload.url);
      }
    } catch (error) {
      setStatus(userFacingFailureMessage(error, language, "operation"));
    }
    return true;
  }

  function startToolsResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const panel = panelRef.current;
    if (!panel) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const minHeight = 96;
    const maxHeight = Math.max(140, Math.floor(rect.height * 0.65));
    const resize = (clientY: number): void => {
      setToolsHeight(Math.min(maxHeight, Math.max(minHeight, Math.round(rect.bottom - clientY))));
    };
    const handlePointerMove = (moveEvent: PointerEvent): void => {
      resize(moveEvent.clientY);
    };
    const stopResize = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      document.body.classList.remove("preview-browser-resizing-tools");
      toolsResizeCleanupRef.current = null;
    };
    toolsResizeCleanupRef.current?.();
    toolsResizeCleanupRef.current = stopResize;
    document.body.classList.add("preview-browser-resizing-tools");
    resize(event.clientY);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
  }

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

  useEffect(() => {
    return desktopApi.onBrowserTaskEvent((event) => {
      setBrowserTaskEvents((current) => [event, ...current].slice(0, 30));
      if (event.type === "task.started") {
        setBrowserTaskId(event.taskId);
        setStatus("browser-use task started.");
      } else if (event.type === "task.failed") {
        setBrowserTaskId(null);
        setPendingTaskApprovals((current) => current.filter((item) => item.taskId !== event.taskId));
        setStatus(event.error);
      } else if (event.type === "task.completed") {
        setBrowserTaskId(null);
        setPendingTaskApprovals((current) => current.filter((item) => item.taskId !== event.taskId));
        setTaskResult(event.result);
        setStatus(event.result);
      } else if (event.type === "task.cancelled") {
        setBrowserTaskId(null);
        setPendingTaskApprovals((current) => current.filter((item) => item.taskId !== event.taskId));
        setStatus("browser-use task cancelled.");
      } else if (event.type === "page.observed") {
        setStatus(`browser-use observed ${event.url}`);
      } else if (event.type === "action.proposed") {
        if (event.requiresApproval) {
          setPendingTaskApprovals((current) => [
            event,
            ...current.filter((item) => item.actionId !== event.actionId),
          ]);
        }
        setStatus(`browser-use proposed ${event.action}: ${event.target || event.actionId}`);
      } else if (event.type === "action.completed") {
        setPendingTaskApprovals((current) => current.filter((item) => item.actionId !== event.actionId));
      } else if (event.type === "screenshot") {
        setTaskScreenshotDataUrl(event.dataUrl);
      }
    });
  }, []);

  function bindWebview(tabId: string): (node: OpenDrSaiWebviewTag | null) => void {
    const existing = webviewRefCallbacks.current.get(tabId);
    if (existing) return existing;
    const callback = (node: OpenDrSaiWebviewTag | null): void => {
      if (!node) {
        webviewRefs.current.delete(tabId);
        setWebviewReady(tabId, false);
        return;
      }
      if (webviewRefs.current.get(tabId) === node) return;
      webviewRefs.current.set(tabId, node);
      setWebviewReady(tabId, false);
      node.addEventListener("dom-ready", () => {
        completeWebviewLoad(tabId, node, { ready: true });
      });
      node.addEventListener("did-start-loading", () => {
        setWebviewReady(tabId, false);
        setTab(tabId, { loading: true });
        if (tabId === activeTabIdRef.current) setStatus("Loading page...");
      });
      node.addEventListener("did-finish-load", () => {
        completeWebviewLoad(tabId, node, { ready: true });
      });
      node.addEventListener("did-stop-loading", () => {
        const url = node.getURL();
        if (url) {
          completeWebviewLoad(tabId, node, { ready: webviewReadyRef.current.has(tabId) });
          return;
        }
        setTab(tabId, { loading: false, url: "", draftUrl: DEFAULT_URL, title: DEFAULT_URL });
        refreshNavigationStateFor(tabId, node);
        if (tabId === activeTabIdRef.current) setStatus("Page stopped before it became ready.");
      });
      const updateTitle = (): void => {
        if (!webviewReadyRef.current.has(tabId)) return;
        const url = node.getURL();
        setTab(tabId, { url, draftUrl: url || DEFAULT_URL, title: node.getTitle() || url });
        refreshNavigationStateFor(tabId, node);
        if (url && tabId === activeTabIdRef.current) setStatus("");
      };
      node.addEventListener("did-navigate", updateTitle);
      node.addEventListener("did-navigate-in-page", updateTitle);
      node.addEventListener("page-title-updated", updateTitle);
      node.addEventListener("did-fail-load", (event) => {
        const detail = event as Event & { errorCode?: number; errorDescription?: string; validatedURL?: string };
        if (detail.errorCode === -3) {
          setTab(tabId, { loading: false });
          if (tabId === activeTabIdRef.current) setStatus("");
          refreshNavigationStateFor(tabId, node);
          return;
        }
        setWebviewReady(tabId, false);
        const message = `${detail.errorCode ?? ""} ${detail.errorDescription ?? "Load failed"} ${detail.validatedURL ?? ""}`.trim();
        setNetworkEvents((current) => [message, ...current].slice(0, 30));
        if (tabId === activeTabIdRef.current) setStatus(message);
        setTab(tabId, { loading: false });
      });
      node.addEventListener("render-process-gone", (event) => {
        setWebviewReady(tabId, false);
        const detail = event as Event & { reason?: string; exitCode?: number };
        const message = `Browser preview process stopped${detail.reason ? `: ${detail.reason}` : ""}${typeof detail.exitCode === "number" ? ` (${detail.exitCode})` : ""}.`;
        setNetworkEvents((current) => [message, ...current].slice(0, 30));
        if (tabId === activeTabIdRef.current) setStatus(message);
        setTab(tabId, { url: "", loading: false });
      });
      node.addEventListener("unresponsive", () => {
        const message = "Browser preview became unresponsive.";
        setNetworkEvents((current) => [message, ...current].slice(0, 30));
        if (tabId === activeTabIdRef.current) setStatus(message);
        setTab(tabId, { loading: false });
      });
      node.addEventListener("console-message", (event) => {
        const detail = event as Event & { message?: string; line?: number; sourceId?: string };
        if (detail.message && handleLinkNavigationMessage(detail.message)) return;
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
      srcUrl: "",
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
      srcUrl: check.normalizedUrl,
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
    const webview = getReadyActiveWebview();
    await desktopApi.requestBrowserAction({ action: "snapshot" });
    return webview.executeJavaScript<PageSnapshot>(SNAPSHOT_SCRIPT, false);
  }

  async function attachContext(mode: "summary" | "screenshot"): Promise<void> {
    try {
      const snapshot = await readSnapshot();
      let screenshotDataUrl: string | undefined;
      if (mode === "screenshot") {
        await desktopApi.requestBrowserAction({ action: "screenshot" });
        screenshotDataUrl = (await getReadyActiveWebview().capturePage()).toDataURL();
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
      setStatus(userFacingFailureMessage(error, language, "operation"));
    }
  }

  async function runReadonlyCheck(): Promise<void> {
    try {
      const result = await desktopApi.requestBrowserAction({ action: "eval_readonly", script: READ_TEXT_SCRIPT });
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      const visibleText = await getReadyActiveWebview().executeJavaScript<string>(READ_TEXT_SCRIPT, false);
      setStatus(
        visibleText
          ? `Read-only check complete: ${visibleText.length} characters.`
          : "Read-only check complete: no visible text.",
      );
    } catch (error) {
      setStatus(userFacingFailureMessage(error, language, "operation"));
    }
  }

  async function pickElement(): Promise<void> {
    try {
      setStatus("Click an element in the page to generate a selector.");
      const selector = await getReadyActiveWebview().executeJavaScript<string>(PICK_ELEMENT_SCRIPT, true);
      if (selector) {
        setActionSelector(selector);
        setStatus(`Selected: ${selector}`);
      }
    } catch (error) {
      setStatus(userFacingFailureMessage(error, language, "operation"));
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
      const target = selector || actionKey;
      const ok = await requestAppDecision({ id: "controlled-browser-action", title: isZh ? "允许网页操作？" : "Allow browser action?", description: isZh ? `动作：${browserActionLabel(mode, true)}；对象：${target}` : `Action: ${browserActionLabel(mode, false)}; target: ${target}`, impact: isZh ? "该操作会在当前网页执行一次，不会自动重复。" : "This action will run once on the current page and will not repeat automatically.", confirmLabel: isZh ? "允许执行一次" : "Allow once" });
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
      const executed = await getReadyActiveWebview().executeJavaScript<string>(script, needsApproval);
      const message = executed || approval.message;
      setActionLog((current) => [`${new Date().toLocaleTimeString()} ${mode}: ${message}`, ...current].slice(0, 12));
      setStatus(message);
      refreshNavigationState();
    } catch (error) {
      setStatus(userFacingFailureMessage(error, language, "operation"));
    }
  }

  async function startBrowserUseTask(): Promise<void> {
    const instruction = taskInstruction.trim();
    if (!instruction) {
      setStatus("Enter a browser-use task instruction.");
      return;
    }
    try {
      const result = await desktopApi.startBrowserTask({
        instruction,
        url: activeTab?.draftUrl || activeTab?.url,
        engine: "browser-use",
      });
      setBrowserTaskId(result.taskId);
      setBrowserTaskEvents([]);
      setPendingTaskApprovals([]);
      setTaskScreenshotDataUrl(null);
      setTaskResult(null);
      setStatus(`browser-use task queued: ${result.taskId}`);
    } catch (error) {
      setStatus(userFacingFailureMessage(error, language, "operation"));
    }
  }

  async function approveBrowserUseAction(actionId: string, approved: boolean): Promise<void> {
    const taskId = browserTaskId || pendingTaskApprovals.find((item) => item.actionId === actionId)?.taskId;
    if (!taskId) return;
    try {
      const accepted = await desktopApi.approveBrowserTaskAction({
        taskId,
        actionId,
        approved,
      });
      if (accepted) {
        setPendingTaskApprovals((current) => current.filter((item) => item.actionId !== actionId));
        setStatus(approved ? "browser-use action approved." : "browser-use action rejected.");
      }
    } catch (error) {
      setStatus(userFacingFailureMessage(error, language, "operation"));
    }
  }

  async function stopBrowserUseTask(): Promise<void> {
    if (!browserTaskId) return;
    try {
      const stopped = await desktopApi.stopBrowserTask({ taskId: browserTaskId });
      if (stopped) {
        setStatus("Stopping browser-use task...");
      }
    } catch (error) {
      setStatus(userFacingFailureMessage(error, language, "operation"));
    }
  }

  return (
    <aside
      ref={panelRef}
      className="preview-browser-panel"
      aria-label={isZh ? "Preview Browser" : "Preview Browser"}
      style={{ "--preview-browser-tools-height": `${toolsHeight}px` } as CSSProperties}
    >
      <form className="preview-browser-topbar" onSubmit={submitUrl}>
        <strong title={activeTab?.title || activeTab?.draftUrl || "Browser"}>Browser</strong>
        <button type="button" disabled={!canGoBack} onClick={() => runBrowserNavigation("back")} title="Back" aria-label="Back">
          <ChevronLeft size={15} />
        </button>
        <button type="button" disabled={!canGoForward} onClick={() => runBrowserNavigation("forward")} title="Forward" aria-label="Forward">
          <ChevronRight size={15} />
        </button>
        <button type="button" disabled={!activeWebviewReady} onClick={() => runBrowserNavigation(activeTab?.loading ? "stop" : "reload")} title={activeTab?.loading ? "Stop" : "Reload"} aria-label={activeTab?.loading ? "Stop" : "Reload"}>
          {activeTab?.loading ? <Square size={13} /> : <RefreshCw size={14} />}
        </button>
        <div className="preview-browser-address">
          <Globe2 size={14} />
          <input value={activeTab?.draftUrl ?? ""} onChange={(event) => activeTab && setTab(activeTab.id, { draftUrl: event.target.value })} placeholder="https://example.com or http://localhost:3000/" />
        </div>
        <button type="submit" className="preview-browser-go" title="Open" aria-label="Open URL">
          {activeTab?.loading ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
        </button>
        <div className="preview-browser-menu-wrap">
          <button
            type="button"
            className="preview-browser-menu-button"
            onClick={() => setBrowserMenuOpen((open) => !open)}
            aria-label={isZh ? "浏览器菜单" : "Browser menu"}
            aria-expanded={browserMenuOpen}
            title={isZh ? "浏览器菜单" : "Browser menu"}
          >
            <MoreVertical size={16} />
          </button>
          {browserMenuOpen && (
            <div className="preview-browser-menu" role="menu">
              <button type="button" role="menuitem" onClick={clearBrowsingData}>
                <span>{isZh ? "清除浏览数据" : "Clear browsing data"}</span>
                <ChevronRight size={14} />
              </button>
              <div className="preview-browser-menu-zoom">
                <span>{isZh ? "缩放" : "Zoom"}</span>
                <button type="button" onClick={() => setBrowserZoom(zoomPercentRef.current - 10)} aria-label={isZh ? "缩小" : "Zoom out"}>
                  <Minus size={13} />
                </button>
                <strong>{zoomPercent}%</strong>
                <button type="button" onClick={() => setBrowserZoom(zoomPercentRef.current + 10)} aria-label={isZh ? "放大" : "Zoom in"}>
                  <Plus size={13} />
                </button>
                <button type="button" onClick={() => setBrowserZoom(100)} aria-label={isZh ? "重置缩放" : "Reset zoom"}>
                  <RefreshCw size={13} />
                </button>
              </div>
              <button type="button" role="menuitem" onClick={forceReload}>
                <span>{isZh ? "强制重新加载" : "Force reload"}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => setFindOpen((open) => !open)}>
                <span>{isZh ? "在页面中查找" : "Find in page"}</span>
              </button>
              {findOpen && (
                <div className="preview-browser-find">
                  <input
                    value={findQuery}
                    onChange={(event) => setFindQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") runFindInPage();
                      if (event.key === "Escape") closeFindInPage();
                    }}
                    placeholder={isZh ? "查找" : "Find"}
                    autoFocus
                  />
                  <button type="button" onClick={runFindInPage}>{isZh ? "查找" : "Find"}</button>
                  <button type="button" onClick={closeFindInPage}>
                    <X size={13} />
                  </button>
                </div>
              )}
              <button type="button" role="menuitem" onClick={showBrowserDevTools}>
                <span>{isZh ? "显示设备工具栏" : "Show device toolbar"}</span>
              </button>
              <div className="preview-browser-menu-separator" />
              <button type="button" role="menuitem" onClick={() => { setStatus("Browser settings are available from this menu."); setBrowserMenuOpen(false); }}>
                <span>{isZh ? "浏览器设置" : "Browser settings"}</span>
              </button>
            </div>
          )}
        </div>
      </form>

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

      <div className="preview-browser-surface">
        {tabs.map((tab) =>
          tab.srcUrl ? (
            <webview key={tab.id} ref={bindWebview(tab.id)} src={tab.srcUrl} partition="persist:opendrsai-preview" webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes" style={{ display: tab.id === activeTabId ? "flex" : "none" }} />
          ) : null,
        )}
        {!activeTab?.srcUrl && (
          <div className="preview-browser-empty">
            <Globe2 size={28} />
            <h3>Enter a URL and click Open</h3>
            <p>The Browser tab does not auto-load pages on open, avoiding a blank panel when local servers are not running.</p>
          </div>
        )}
      </div>

      <div
        className="preview-browser-tools-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={isZh ? "调整浏览器页面和工具区大小" : "Resize browser page and tools"}
        onPointerDown={startToolsResize}
      />

      <div className="preview-browser-tools">
        {(status || attachedCount > 0) && (
          <div className={`preview-browser-status ${statusTone}`}>
            {statusTone === "warning" ? <ShieldAlert size={14} /> : <Code2 size={14} />}
            <span>{status}</span>
            {attachedCount > 0 && <strong>{attachedCount}</strong>}
          </div>
        )}

        <div className="preview-browser-context-strip">
          <span><FileText size={14} />Context</span>
          <button type="button" onClick={() => void attachContext("summary")} disabled={!activeTab?.url || !activeWebviewReady}><FileText size={14} />Text</button>
          <button type="button" onClick={() => void attachContext("screenshot")} disabled={!activeTab?.url || !activeWebviewReady}><Camera size={14} />Shot</button>
          <button type="button" onClick={() => void runReadonlyCheck()} disabled={!activeTab?.url || !activeWebviewReady}><MousePointerClick size={14} />Read</button>
          <button type="button" onClick={toggleBookmark} disabled={!activeTab?.url}><Bookmark size={14} />{bookmarked ? "Saved" : "Save"}</button>
          <button type="button" onClick={() => setShowLibrary(showLibrary === "history" ? null : "history")}><Clock size={14} />History</button>
          <button type="button" onClick={() => setShowLibrary(showLibrary === "bookmarks" ? null : "bookmarks")}><Bookmark size={14} />Marks</button>
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

        <details className="preview-browser-tool-group">
          <summary>
            <Crosshair size={14} />
            <span>Page Actions</span>
          </summary>
          <div className="preview-browser-control">
            <input value={actionSelector} onChange={(event) => setActionSelector(event.target.value)} placeholder="CSS selector" disabled={!activeTab?.url || !activeWebviewReady} />
            <input value={actionText} onChange={(event) => setActionText(event.target.value)} placeholder="Text / value / assertion" disabled={!activeTab?.url || !activeWebviewReady} />
            <input value={actionKey} onChange={(event) => setActionKey(event.target.value)} placeholder="Enter" disabled={!activeTab?.url || !activeWebviewReady} />
            <button type="button" onClick={() => void pickElement()} disabled={!activeTab?.url || !activeWebviewReady} title="Pick"><Crosshair size={14} /></button>
            <button type="button" onClick={() => void runControlledAction("click")} disabled={!activeTab?.url || !activeWebviewReady} title="Click"><MousePointerClick size={14} /></button>
            <button type="button" onClick={() => void runControlledAction("type")} disabled={!activeTab?.url || !activeWebviewReady} title="Type"><Type size={14} /></button>
            <button type="button" onClick={() => void runControlledAction("select")} disabled={!activeTab?.url || !activeWebviewReady} title="Select"><Send size={14} /></button>
            <button type="button" onClick={() => void runControlledAction("key_press")} disabled={!activeTab?.url || !activeWebviewReady} title="Key"><Keyboard size={14} /></button>
            <button type="button" onClick={() => void runControlledAction("wait_for")} disabled={!activeTab?.url || !activeWebviewReady} title="Wait"><Clock size={14} /></button>
            <button type="button" onClick={() => void runControlledAction("assert_text")} disabled={!activeTab?.url || !activeWebviewReady} title="Assert"><Code2 size={14} /></button>
          </div>
          {actionLog.length > 0 && <div className="preview-browser-action-log">{actionLog.map((item) => <span key={item}>{item}</span>)}</div>}
        </details>

        <details className="preview-browser-tool-group">
          <summary>
            <Keyboard size={14} />
            <span>Agent Task</span>
          </summary>
          <div className="preview-browser-task">
            <div className="preview-browser-task-input">
              <input
                value={taskInstruction}
                onChange={(event) => setTaskInstruction(event.target.value)}
                placeholder="Agent browser task"
              />
              {browserTaskId ? (
                <button type="button" onClick={() => void stopBrowserUseTask()}>
                  <Square size={14} />
                  Stop
                </button>
              ) : (
                <button type="button" onClick={() => void startBrowserUseTask()}>
                  <Send size={14} />
                  Run
                </button>
              )}
            </div>
            {browserTaskEvents.length > 0 && (
              <div className="preview-browser-task-events">
                {browserTaskEvents.map((event, index) => (
                  <span key={`${event.taskId}-${event.type}-${index}`}>
                    {formatBrowserTaskEvent(event)}
                  </span>
                ))}
              </div>
            )}
            {pendingTaskApprovals.length > 0 && (
              <div className="preview-browser-task-approvals">
                {pendingTaskApprovals.map((approval) => (
                  <div key={approval.actionId}>
                    <span>{approval.action}: {approval.target || approval.actionId}</span>
                    <button type="button" onClick={() => void approveBrowserUseAction(approval.actionId, true)}>
                      Approve
                    </button>
                    <button type="button" onClick={() => void approveBrowserUseAction(approval.actionId, false)}>
                      Reject
                    </button>
                  </div>
                ))}
              </div>
            )}
            {taskScreenshotDataUrl ? (
              <img
                className="preview-browser-task-screenshot"
                src={taskScreenshotDataUrl}
                alt="browser-use task screenshot"
              />
            ) : null}
            {taskResult ? <p className="preview-browser-task-result">{taskResult}</p> : null}
          </div>
        </details>
      </div>
    </aside>
  );
}

function browserActionLabel(mode: BrowserActionMode, zh: boolean): string {
  const labels: Record<BrowserActionMode, [string, string]> = {
    click: ["点击", "Click"], type: ["输入文字", "Type text"], select: ["选择选项", "Select option"],
    key_press: ["按键", "Press key"], assert_text: ["检查文字", "Check text"], wait_for: ["等待页面内容", "Wait for page content"],
  };
  return labels[mode]?.[zh ? 0 : 1] ?? (zh ? "网页操作" : "Browser action");
}

function formatBrowserTaskEvent(event: BrowserTaskEvent): string {
  if (event.type === "task.started") return `${event.taskId}: started`;
  if (event.type === "page.observed") return `${event.taskId}: observed ${event.url}`;
  if (event.type === "action.proposed") return `${event.taskId}: proposed ${event.action} ${event.target || event.actionId}`;
  if (event.type === "action.completed") return `${event.taskId}: action ${event.actionId} ${event.ok ? "ok" : "failed"} ${event.message}`;
  if (event.type === "screenshot") return `${event.taskId}: screenshot captured`;
  if (event.type === "task.completed") return `${event.taskId}: completed ${event.result}`;
  if (event.type === "task.failed") return `${event.taskId}: failed ${event.error}`;
  return `${event.taskId}: cancelled`;
}
