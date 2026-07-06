import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = {
  panel: read("src/renderer/src/components/PreviewBrowserPanel.tsx"),
  shell: read("src/renderer/src/components/WorkspaceShell.tsx"),
  app: read("src/renderer/src/App.tsx"),
  chat: read("src/main/chat.ts"),
  main: read("src/main/index.ts"),
  shared: read("src/shared/desktopApi.ts"),
  navigation: read("src/renderer/src/navigation.ts"),
  styles: read("src/renderer/src/styles.css"),
  sharedBrowserTypes: read("src/shared/browser/types.ts"),
  sharedBrowserPolicy: read("src/shared/browser/actionPolicy.ts"),
  mainBrowserUrlPolicy: read("src/main/browser/urlPolicy.ts"),
  mainBrowserApproval: read("src/main/browser/actionApproval.ts"),
  mainBrowserController: read("src/main/browser/browserController.ts"),
  mainBrowserRegistry: read("src/main/browser/browserControllerRegistry.ts"),
  electronController: read("src/main/browser/adapters/electronWebviewController.ts"),
  browserUseController: read("src/main/browser/adapters/browserUseController.ts"),
  browserUseProtocol: read("src/main/browser/browserUse/protocol.ts"),
  browserUseWorkerClient: read("src/main/browser/browserUse/workerClient.ts"),
  browserTaskTrace: read("src/main/browser/browserTaskTrace.ts"),
  browserUseSmoke: read("scripts/verify-browser-use-worker-smoke.mjs"),
  browserTypes: read("src/renderer/src/components/previewBrowser/types.ts"),
  browserState: read("src/renderer/src/components/previewBrowser/state.ts"),
  browserScripts: read("src/renderer/src/components/previewBrowser/scripts.ts"),
  browserBoundary: read("src/renderer/src/components/previewBrowser/BrowserPanelErrorBoundary.tsx"),
  browserUseWorker: read("src/python/browser_use_worker/worker.py"),
};

const browserModule = [
  files.panel,
  files.browserTypes,
  files.browserState,
  files.browserScripts,
  files.browserBoundary,
  files.sharedBrowserTypes,
  files.sharedBrowserPolicy,
  files.mainBrowserUrlPolicy,
  files.mainBrowserApproval,
  files.mainBrowserController,
  files.browserUseController,
  files.browserUseProtocol,
].join("\n");

const checks = [
  ["V1 right sidebar Browser tab", files.navigation.includes('"browser"') && files.app.includes('activeRightTab === "browser"')],
  ["V1 browser panel rendered in right side", files.app.includes("<PreviewBrowserPanel")],
  ["V1 compact one-line browser topbar", files.panel.includes("preview-browser-topbar") && files.styles.includes("grid-template-columns: auto 28px 28px 28px minmax(0, 1fr) auto 28px") && !files.panel.includes("preview-browser-toolbar")],
  ["V1 icon-only open button", files.panel.includes('aria-label="Open URL"') && !files.panel.includes("<span>Open</span>") && files.styles.includes("width: 28px !important")],
  ["V1 browser topbar menu replaces close button", !files.panel.includes("Close Browser") && files.panel.includes("MoreVertical") && files.panel.includes("preview-browser-menu") && files.panel.includes("clearBrowsingData") && files.panel.includes("setBrowserZoom") && files.panel.includes("forceReload") && files.panel.includes("runFindInPage") && files.panel.includes("showBrowserDevTools")],
  ["V1 browser zoom applies to page content", files.panel.includes("applyBrowserZoom") && files.panel.includes("setZoomFactor") && files.panel.includes("setZoomLevel") && files.panel.includes("document.documentElement.style.zoom") && files.panel.includes("zoomPercentRef.current")],
  ["V1 no redundant page ready status row", !files.panel.includes('"Page ready."')],
  ["V2 context tools grouped at bottom", files.panel.includes('className="preview-browser-tools"') && files.panel.includes("preview-browser-tool-group") && files.panel.indexOf("preview-browser-surface") < files.panel.indexOf('className="preview-browser-tools"')],
  ["V2 status lives in bottom tools", files.panel.includes("preview-browser-status") && files.panel.indexOf('className="preview-browser-tools"') < files.panel.indexOf("preview-browser-status")],
  ["V2 resizable browser tools split", files.panel.includes("preview-browser-tools-resize") && files.panel.includes("startToolsResize") && files.panel.includes("--preview-browser-tools-height") && files.styles.includes("grid-template-rows: auto auto minmax(0, 1fr) 7px minmax(96px, var(--preview-browser-tools-height, 168px))") && files.styles.includes("cursor: row-resize")],
  ["V2 context tools compressed into one bottom-aligned row", files.panel.includes("preview-browser-context-strip") && files.styles.includes("grid-template-columns: auto repeat(6, max-content)") && files.styles.includes("align-self: end")],
  ["V2 browser panel fills right sidebar height", files.shell.includes('activeRightTab === "browser" ? "browser-right-panel"') && files.styles.includes(".right-panel.browser-right-panel") && files.styles.includes("flex: 1 1 auto") && files.styles.includes("height: 100%") && files.styles.includes("overflow: hidden")],
  ["V1 public HTTPS and local URL policy", files.mainBrowserUrlPolicy.includes("Public HTTPS URL allowed") && files.mainBrowserUrlPolicy.includes("Local development URL allowed")],
  ["V1 blocks public HTTP and credential URLs", files.mainBrowserUrlPolicy.includes("Public browser preview requires HTTPS") && files.mainBrowserUrlPolicy.includes("Browser preview does not allow credentials")],
  ["V1 blocks file URLs through browser surface", files.mainBrowserUrlPolicy.includes("Use workspace file previews through the OpenDrSai file preview flow")],
  ["V1 webview security policy", files.main.includes("will-attach-webview") && files.main.includes("nodeIntegration = false") && files.main.includes("setPermissionRequestHandler")],
  ["V1 blocks popups downloads redirects permissions", files.main.includes("setWindowOpenHandler(() => ({ action: \"deny\" }))") && files.main.includes("will-download") && files.main.includes("will-redirect") && files.main.includes("callback(false)")],
  ["V1 browser module split", files.panel.includes("./previewBrowser/scripts") && files.panel.includes("./previewBrowser/state") && files.panel.includes("./previewBrowser/types") && files.panel.includes("./previewBrowser/BrowserPanelErrorBoundary")],
  ["V2 shared browser controller contract", files.mainBrowserController.includes("interface BrowserController") && files.mainBrowserRegistry.includes("registerBrowserController") && files.electronController.includes("ElectronWebviewController")],
  ["V1 persistent session partition", browserModule.includes('partition="persist:opendrsai-preview"')],
  ["V1 multi-tab UI", files.panel.includes("preview-browser-tabs") && files.panel.includes("addTab") && files.panel.includes("closeTab")],
  ["V1 history and bookmarks", browserModule.includes("BrowserHistoryItem") && browserModule.includes("BrowserBookmark") && files.panel.includes("toggleBookmark")],
  ["V1 restored browser state", browserModule.includes("STORAGE_KEY") && browserModule.includes("loadState()")],
  ["V1 lazy webview mount on Browser tab open", browserModule.includes('createTab(DEFAULT_URL, "")') && browserModule.includes('url: ""') && browserModule.includes("does not auto-load pages on open")],
  ["V1 chat link stages URL before loading", files.panel.includes("stageUrl(initialUrl)") && files.panel.includes("Link staged. Click Open") && !files.panel.includes("void navigate(initialUrl)")],
  ["V1 stable webview ref callbacks", files.panel.includes("webviewRefCallbacks") && files.panel.includes("webviewRefCallbacks.current.set")],
  ["V1 browser panel error boundary", browserModule.includes("BrowserPanelErrorBoundary") && browserModule.includes("getDerivedStateFromError")],
  ["V1 webview crash recovery", files.panel.includes('"render-process-gone"') && files.panel.includes('"unresponsive"')],
  ["V1 webview dom-ready gate", files.panel.includes('"dom-ready"') && files.panel.includes("getReadyActiveWebview") && files.panel.includes("activeWebviewReady")],
  ["V1 basic browser navigation state", files.panel.includes('"did-finish-load"') && files.panel.includes("completeWebviewLoad") && files.panel.includes("runBrowserNavigation") && files.panel.includes("detail.errorCode === -3")],
  ["V1 in-page links respect site tab disposition", files.browserScripts.includes("LINK_NAVIGATION_SCRIPT") && files.browserScripts.includes("LINK_NAVIGATION_MESSAGE") && files.browserScripts.includes("target === '_blank'") && files.browserScripts.includes("window.open") && files.panel.includes("handleLinkNavigationMessage") && files.panel.includes("openInNewTab")],
  ["V1 webview src is isolated from observed page URL", files.browserTypes.includes("srcUrl: string") && files.browserState.includes("srcUrl: url") && files.browserState.includes('srcUrl: ""') && files.panel.includes("src={tab.srcUrl}") && !files.panel.includes("src={tab.url}")],
  ["V1 webview actions disabled before dom-ready", files.panel.includes("disabled={!activeTab?.url || !activeWebviewReady}") && files.panel.includes("disabled={!activeWebviewReady}")],
  ["V2 attach browser context", files.panel.includes('kind: "browser"') && files.chat.includes("Preview Browser context")],
  ["V2 visible text and DOM structure", browserModule.includes("visibleText") && files.panel.includes("Interactive elements") && files.panel.includes("rect=")],
  ["V2 screenshot data path", files.panel.includes("capturePage") && files.shared.includes("screenshotDataUrl") && files.chat.includes("MAX_BROWSER_SCREENSHOT_DATA_URL_CHARS")],
  ["V2 console and network evidence", files.panel.includes("console-message") && files.panel.includes("Network/load issues")],
  ["V3 browser action API", files.sharedBrowserTypes.includes('"select"') && files.sharedBrowserTypes.includes('"key_press"') && files.sharedBrowserTypes.includes('"assert_text"')],
  ["V3 approval boundary", files.sharedBrowserPolicy.includes("Interactive browser actions require explicit approval") && files.panel.includes("window.confirm")],
  ["V3 sensitive approval policy", files.sharedBrowserPolicy.includes("browserActionRequiresSensitiveApproval") && files.sharedBrowserPolicy.includes("checkout") && files.sharedBrowserPolicy.includes("cross")],
  ["V3 browser-use adapter scaffold", files.browserUseController.includes("BrowserUseController") && files.browserUseProtocol.includes("task.start") && files.browserUseWorkerClient.includes("BrowserUseWorkerClient") && files.browserUseWorker.includes("from browser_use import Agent, ChatBrowserUse")],
  ["V3 browser task IPC", files.shared.includes("startBrowserTask") && files.shared.includes("approveBrowserTaskAction") && files.main.includes("desktop:browser-task-start") && files.main.includes("desktop:browser-task-approve") && files.main.includes("desktop:browser-task-event")],
  ["V3 browser task UI", files.panel.includes("taskInstruction") && files.panel.includes("startBrowserUseTask") && files.panel.includes("preview-browser-task-events") && files.styles.includes(".preview-browser-task")],
  ["V3 pending approval UI", files.panel.includes("pendingTaskApprovals") && files.panel.includes("approveBrowserUseAction") && files.panel.includes("Approve") && files.panel.includes("Reject")],
  ["V3 task screenshot and result cockpit", files.panel.includes("taskScreenshotDataUrl") && files.panel.includes("preview-browser-task-screenshot") && files.panel.includes("taskResult")],
  ["V3 task trace persistence", files.browserTaskTrace.includes("initializeBrowserTaskTrace") && files.browserTaskTrace.includes("appendBrowserTaskTraceEvent") && files.browserTaskTrace.includes("screenshots") && files.browserTaskTrace.includes("failureReason")],
  ["V3 browser-use worker smoke", files.browserUseSmoke.includes("fallback-task") && files.browserUseSmoke.includes("fake-real-task") && files.browserUseSmoke.includes("action.approve") && files.browserUseSmoke.includes("task.completed")],
  ["V3 element picker", browserModule.includes("PICK_ELEMENT_SCRIPT") && files.panel.includes("pickElement")],
  ["V3 wait/assert/actions", browserModule.includes("wait_for") && browserModule.includes("assert_text") && browserModule.includes("createActionScript")],
  ["V3 action log", files.panel.includes("actionLog") && files.styles.includes("preview-browser-action-log")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

if (failed.length) {
  console.error(`\nPreview Browser verification failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nPreview Browser V1/V2/V3 verification passed.");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}
