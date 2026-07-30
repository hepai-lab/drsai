import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const checks = {
  typedFailureContract: /interface DesktopFailureRecovery[\s\S]*attempts: number;[\s\S]*retryLimit: number;[\s\S]*escalationLevel:/.test(read("../shared/api/desktopApi.ts")),
  boundedNetworkRetry: /NETWORK_RECOVERY_WINDOW_MS/.test(read("../shared/main/agentRuns.ts"))
    && /createFailureEscalation/.test(read("../shared/main/agentRuns.ts")),
  stableIdempotencyKey: /Idempotency-Key.*desktop-agent-\$\{requestId\}/.test(read("../shared/main/agentRuns.ts")),
  failureClassification: /kind: "file_busy"/.test(read("../shared/main/failureRecovery.ts"))
    && /kind: "external_service"/.test(read("../shared/main/failureRecovery.ts"))
    && /kind: "network"/.test(read("../shared/main/failureRecovery.ts")),
  fileWriteRetryLimit: /fileWriteRetryLimit/.test(read("../shared/main/managerPresentation.ts"))
    && /FileWriteRetryExhaustedError/.test(read("../shared/main/managerPresentation.ts")),
  chatRetryIsExposed: /event\.failureRecovery\?\.retryable/.test(read("../shared/renderer/src/adapters/useDesktopChatAdapter.ts")),
  agentGuidanceIsVisible: /failureRecovery\.suggestedAction/.test(read("../shared/renderer/src/components/AgentRunWorkspace.tsx")),
  presentationGuidanceIsVisible: /manager-presentation-failure-recovery/.test(read("../shared/renderer/src/components/files/FilesContextPanel.tsx")),
  uiDoesNotOverwriteStructuredFailure: /current\.phase === "failed"[\s\S]*\? current/.test(read("../shared/renderer/src/components/files/FilesContextPanel.tsx")),
  packagedFaultInjection: /file-busy-retry/.test(read("scripts/verify-packaged-presentation-pdf-action.mjs"))
    && /network-exhausted/.test(read("scripts/verify-e2e-agent-run-failures.mjs"))
    && /external-service/.test(read("scripts/verify-e2e-agent-run-failures.mjs")),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length > 0) {
  throw new Error(`K4 failure recovery contract failed: ${failed.join(", ")}`);
}
console.log(JSON.stringify({ ok: true, checks }, null, 2));
