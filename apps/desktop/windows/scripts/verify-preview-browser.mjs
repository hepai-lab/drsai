import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = {
  panel: read("src/renderer/src/components/PreviewBrowserPanel.tsx"),
  app: read("src/renderer/src/App.tsx"),
  chat: read("src/main/chat.ts"),
  main: read("src/main/index.ts"),
  shared: read("src/shared/desktopApi.ts"),
  navigation: read("src/renderer/src/navigation.ts"),
  styles: read("src/renderer/src/styles.css"),
};

const checks = [
  ["V1 right sidebar Browser tab", files.navigation.includes('"browser"') && files.app.includes('activeRightTab === "browser"')],
  ["V1 browser panel rendered in right side", files.app.includes("<PreviewBrowserPanel")],
  ["V1 public HTTPS and local URL policy", files.main.includes("Public HTTPS URL allowed") && files.main.includes("Local development URL allowed")],
  ["V1 webview security policy", files.main.includes("will-attach-webview") && files.main.includes("nodeIntegration = false") && files.main.includes("setPermissionRequestHandler")],
  ["V1 persistent session partition", files.panel.includes('partition="persist:opendrsai-preview"')],
  ["V1 multi-tab UI", files.panel.includes("preview-browser-tabs") && files.panel.includes("addTab") && files.panel.includes("closeTab")],
  ["V1 history and bookmarks", files.panel.includes("BrowserHistoryItem") && files.panel.includes("BrowserBookmark") && files.panel.includes("toggleBookmark")],
  ["V1 restored browser state", files.panel.includes("STORAGE_KEY") && files.panel.includes("loadState()")],
  ["V1 lazy webview mount on Browser tab open", files.panel.includes('createTab(DEFAULT_URL, "")') && files.panel.includes('url: ""') && files.panel.includes("does not auto-load pages on open")],
  ["V1 chat link stages URL before loading", files.panel.includes("stageUrl(initialUrl)") && files.panel.includes("Link staged. Click Open") && !files.panel.includes("void navigate(initialUrl)")],
  ["V1 stable webview ref callbacks", files.panel.includes("webviewRefCallbacks") && files.panel.includes("webviewRefCallbacks.current.set")],
  ["V1 browser panel error boundary", files.panel.includes("BrowserPanelErrorBoundary") && files.panel.includes("getDerivedStateFromError")],
  ["V1 webview crash recovery", files.panel.includes('"render-process-gone"') && files.panel.includes('"unresponsive"')],
  ["V2 attach browser context", files.panel.includes('kind: "browser"') && files.chat.includes("Preview Browser context")],
  ["V2 visible text and DOM structure", files.panel.includes("visibleText") && files.panel.includes("Interactive elements") && files.panel.includes("rect=")],
  ["V2 screenshot data path", files.panel.includes("capturePage") && files.shared.includes("screenshotDataUrl") && files.chat.includes("MAX_BROWSER_SCREENSHOT_DATA_URL_CHARS")],
  ["V2 console and network evidence", files.panel.includes("console-message") && files.panel.includes("Network/load issues")],
  ["V3 browser action API", files.shared.includes('"select"') && files.shared.includes('"key_press"') && files.shared.includes('"assert_text"')],
  ["V3 approval boundary", files.main.includes("Interactive browser actions require explicit approval") && files.panel.includes("window.confirm")],
  ["V3 element picker", files.panel.includes("PICK_ELEMENT_SCRIPT") && files.panel.includes("pickElement")],
  ["V3 wait/assert/actions", files.panel.includes("wait_for") && files.panel.includes("assert_text") && files.panel.includes("createActionScript")],
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
