import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sharedRoot = resolve(root, "../shared");
const files = {
  core: readFileSync(join(sharedRoot, "api/sensitiveData.ts"), "utf8"),
  share: readFileSync(join(sharedRoot, "main/shareSensitivity.ts"), "utf8"),
  shares: readFileSync(join(sharedRoot, "main/shares.ts"), "utf8"),
  diagnostics: readFileSync(join(sharedRoot, "main/diagnostics.ts"), "utf8"),
  gateway: readFileSync(join(sharedRoot, "main/gateway.ts"), "utf8"),
  notifications: readFileSync(join(sharedRoot, "main/completionNotifications.ts"), "utf8"),
  debug: readFileSync(join(sharedRoot, "renderer/src/debugLogStore.ts"), "utf8"),
  chat: readFileSync(join(sharedRoot, "renderer/src/adapters/useDesktopChatAdapter.ts"), "utf8"),
  memory: readFileSync(join(sharedRoot, "renderer/src/userPreferenceIntent.ts"), "utf8"),
  app: readFileSync(join(sharedRoot, "renderer/src/App.tsx"), "utf8"),
  localExport: readFileSync(join(sharedRoot, "renderer/src/localDataExport.ts"), "utf8"),
};

const checks = {
  commonScannerCoversSecretsAndPersonalData: ["api_key", "user_secret", "bearer_token", "email", "phone"].every((kind) => files.core.includes(`\"${kind}\"`)),
  shareUsesCommonScanner: files.share.includes('from "../api/sensitiveData"') && files.share.includes("scanSensitiveData(text)"),
  mainDiagnosticsUseCommonRedaction: files.diagnostics.includes('from "../api/sensitiveData"') && files.diagnostics.includes("redactSensitiveData(value)"),
  gatewayLogsUseCommonRedaction: files.gateway.includes("redactSensitiveData(redactDesktopSecrets"),
  rendererLogsSanitizeNestedValues: files.debug.includes("sanitizeSensitiveValue") && files.debug.includes("safeEvent = sanitizeSensitiveValue(event)"),
  chatInputAndOutputUseCommonPipeline: files.memory.includes("scanSensitiveData(text)") && files.memory.includes("redactSensitiveData(text)") && files.chat.includes("event = sanitizeSensitiveValue(event)"),
  notificationsUseCommonPipeline: files.notifications.includes("redactSensitiveData(value.replace"),
  localExportRedactedBeforeBlob: files.localExport.includes("redactSensitiveData(JSON.stringify") && files.app.includes("buildLocalDesktopDataExport(contentOnlySnapshots"),
  sharePromptsForResolution: files.app.includes('data-testid="share-sensitive-review"') && files.app.includes("Sensitive information check") && files.shares.includes("validateSensitiveResolutions(findings, resolutions)"),
};
const failed = Object.entries(checks).filter(([, passed]) => !passed);
if (failed.length) throw new Error(`F5 sensitive-data contract failed: ${failed.map(([name]) => name).join(", ")}`);
console.log(`F5 sensitive-data pipeline contract passed ${Object.keys(checks).length}/${Object.keys(checks).length} checks.`);
