import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const rendererFiles = [
  "../shared/renderer/src/App.tsx",
  "../shared/renderer/src/components/DebugPanel.tsx",
  "../shared/renderer/src/components/files/PatchReviewPanel.tsx",
  "../shared/renderer/src/components/PreviewBrowserPanel.tsx",
  "../shared/renderer/src/components/WorkspaceShell.tsx",
  "../shared/renderer/src/components/files/FilesContextPanel.tsx",
  "../shared/renderer/src/components/GfsView.tsx",
  "../shared/renderer/src/components/SkillsManager.tsx",
  "../shared/renderer/src/components/PerceptorSettingsPanel.tsx",
];
const activeRenderer = rendererFiles.map(read).join("\n");
const host = read("../shared/renderer/src/components/AppDecisionDialog.tsx");
const preload = read("../shared/main/preload.ts");
const app = read("../shared/renderer/src/App.tsx");

const checks = {
  nativeConfirmRemoved: !/window\.confirm\s*\(/.test(activeRenderer),
  nativeAlertRemoved: !/window\.alert\s*\(/.test(activeRenderer),
  centralDecisionApiUsed: /requestAppDecision\s*\(/.test(activeRenderer),
  centralNoticeApiUsed: /showAppNotice\s*\(/.test(activeRenderer),
  modalSemantics: /role=\{notice \? "dialog" : "alertdialog"\}/.test(host) && /aria-modal="true"/.test(host),
  labelledAndDescribed: /aria-labelledby=\{titleId\}/.test(host) && /aria-describedby=\{descriptionId\}/.test(host),
  safeInitialFocus: /safeButtonRef\.current\?\.focus\(\)/.test(host),
  escapeCancels: /event\.key === "Escape"/.test(host) && /finish\(false, "escape"\)/.test(host),
  backdropCancels: /event\.target === event\.currentTarget/.test(host) && /finish\(false, "backdrop"\)/.test(host),
  tabTrap: /event\.key !== "Tab"/.test(host) && /last\.focus\(\)/.test(host) && /first\.focus\(\)/.test(host),
  focusReturnsToTrigger: /request\.trigger\?\.isConnected && request\.trigger\.focus\(\)/.test(host),
  queueIsExplicit: /const waiting: PendingDecision\[\]/.test(host) && /waiting\.shift\(\)/.test(host),
  decisionEventEmitted: /drsai:app-dialog-decision/.test(host),
  decisionAudited: /component: "app-decision-dialog"/.test(host) && /operation: "dialog\.decision"/.test(host),
  chineseDefaultsIntact: host.includes('"影响："') && host.includes('"取消"') && host.includes('"确认"') && host.includes('"知道了"'),
  productionTestGateClosedByDefault: /OPENDRSAI_E2E_APP_DIALOG === "1"/.test(preload),
  e2eListenerGated: /if \(!desktopApi\.isAppDialogE2eEnabled\(\)\) return/.test(app),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed);
if (failed.length) throw new Error(`M06 app-dialog contract failed: ${failed.map(([name]) => name).join(", ")}`);
console.log(`M06 app-dialog contract passed (${Object.keys(checks).length}/${Object.keys(checks).length}; active native confirm/alert calls 0).`);
