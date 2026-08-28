import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendResumedContent, createStreamAttemptCursor } from "../../shared/main/networkRecovery.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const agent = read("../shared/main/agentRuns.ts");
const chat = read("../shared/main/chat.ts");
const recovery = read("../shared/main/networkRecovery.ts");
const api = read("../shared/api/desktopApi.ts");
const app = read("../shared/renderer/src/App.tsx");
const agentUi = read("../shared/renderer/src/components/AgentRunWorkspace.tsx");

const checks = {
  threeMinuteRecoveryWindow: /NETWORK_RECOVERY_WINDOW_MS[^\n]+180_000/.test(agent) && /NETWORK_RECOVERY_WINDOW_MS[^\n]+180_000/.test(chat),
  fiveMinuteOverallTimeout: /AGENT_RUN_TIMEOUT_MS[^\n]+300_000/.test(agent) && /CHAT_TIMEOUT_MS[^\n]+300_000/.test(chat),
  stableIdempotencyKeys: agent.includes('"Idempotency-Key": `desktop-agent-${requestId}`') && chat.includes('"Idempotency-Key": `desktop-chat-${requestId}`'),
  resumeOffsetSent: [agent, chat].every((source) => source.includes("resume_from_chars: resumeState.content.length")),
  retryAttemptSent: [agent, chat].every((source) => source.includes("network_retry_attempt: recoveryAttempt")),
  retryableHttpStatuses: [agent, chat].every((source) => source.includes("response.status === 408") && source.includes("response.status === 429") && source.includes("response.status >= 500")),
  replayDeduplication: recovery.includes("cursor.baseline.startsWith(cursor.received)") && recovery.includes("cursor.received.startsWith(cursor.baseline)"),
  sideEffectDeduplication: agent.includes("resumeState.fileEventKeys.has(key)") && chat.includes("resumeState.fileEventKeys.has(key)"),
  abortableBackoff: recovery.includes('signal.addEventListener("abort"') && recovery.includes("networkRetryDelayMs"),
  explicitOfflineMessage: [agent, chat].every((source) => source.includes("网络连接中断") && source.includes("网络已恢复")),
  agentStatusEventContract: ["chunk", "status", "file_event"].every((type) => api.includes(`"${type}"`)) && agentUi.includes('event.type === "status"'),
  globalConnectivityBanner: app.includes('data-testid="network-connectivity-status"') && app.includes('window.addEventListener("offline"') && app.includes('window.addEventListener("online"'),
  localWorkContinuesCopy: app.includes("本地文件处理会继续"),
  retainedOutputCopy: app.includes("现有内容不会丢失"),
};

const replayState = { content: "已保留的前缀", fileEventKeys: new Set() };
const replayCursor = createStreamAttemptCursor(replayState);
checks.replayedPrefixSuppressed = appendResumedContent(replayState, replayCursor, "已保留") === "";
checks.onlyNovelReplaySuffixEmitted = appendResumedContent(replayState, replayCursor, "的前缀和新内容") === "和新内容";
const resumedCursor = createStreamAttemptCursor(replayState);
checks.serverResumeSuffixAccepted = appendResumedContent(replayState, resumedCursor, "，继续完成") === "，继续完成";
checks.finalContentExactlyOnce = replayState.content === "已保留的前缀和新内容，继续完成";

for (const [name, passed] of Object.entries(checks)) {
  if (!passed) throw new Error(`Network recovery contract failed: ${name}`);
}
console.log(`Network recovery contract passed (${Object.keys(checks).length} checks).`);
