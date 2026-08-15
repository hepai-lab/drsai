import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const [api, client, preload, windows, macos, macosCatalog, view, card, chat, adapters, readiness, styles] = await Promise.all([
  read("../api/desktopApi.ts"),
  read("../main/wechatChannel.ts"),
  read("../main/preload.ts"),
  read("../../windows/src/main/index.ts"),
  read("../../macos/src/main/ipc/registerConnectionsIpc.ts"),
  read("../../macos/src/main/threadSnapshotController.ts"),
  read("../renderer/src/components/ChannelsView.tsx"),
  read("../renderer/src/components/WeChatChannelCard.tsx"),
  read("../renderer/src/components/ChatWorkspace.tsx"),
  read("../main/channelAdapters.ts"),
  read("../main/externalConnectionReadiness.ts"),
  read("../renderer/src/styles.css"),
]);

for (const method of ["getWeChatChannelStatus", "startWeChatLogin", "pollWeChatLogin", "cancelWeChatLogin", "startWeChatChannel", "stopWeChatChannel", "logoutWeChatChannel", "getWeChatSessionSummary", "getWeChatReplyCapability", "sendToWeChat"]) {
  assert(api.includes(method), `DesktopApi omits ${method}`);
  assert(preload.includes(method), `preload omits ${method}`);
}
for (const channel of ["desktop:wechat-channel-status", "desktop:wechat-login-start", "desktop:wechat-login-poll", "desktop:wechat-login-cancel", "desktop:wechat-channel-start", "desktop:wechat-channel-stop", "desktop:wechat-channel-logout", "desktop:wechat-sessions-summary", "desktop:wechat-reply-capability", "desktop:wechat-send-outbound"]) {
  assert(preload.includes(channel), `preload omits ${channel}`);
  assert(windows.includes(channel), `Windows IPC omits ${channel}`);
  assert(macos.includes(channel), `macOS IPC omits ${channel}`);
}
assert(client.includes("getAuthenticatedGatewayRequestHeaders()"), "WeChat client does not attach the current Desktop OIDC context");
assert(client.includes("MAX_RESPONSE_BYTES") && client.includes("AbortSignal.timeout"), "WeChat client lacks response/time bounds");
assert(client.includes("OPERATION_ID.test"), "WeChat client does not validate login operation ids");
assert(api.includes("DesktopWeChatModelRef") && api.includes("imageUnderstanding") && api.includes("imageGeneration"), "WeChat status omits configured model capabilities");
assert(client.includes("model_policy") && client.includes("media_capabilities"), "WeChat client does not map Runtime model policy");
assert(!client.includes("bot_token") && !client.includes("ilink_user_id"), "Desktop WeChat client knows Runtime credential fields");
assert(adapters.includes('id: "wechat-chat"') && adapters.includes('provider: "wechat"'), "channel catalog omits WeChat");
assert(readiness.includes('id: "wechat"'), "external readiness omits WeChat");
assert(view.includes("WeChatChannelCard"), "Channels view omits the WeChat card");
assert(/\.channels-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s.test(styles), "channel cards are not arranged vertically");
assert(card.includes("QRCode.toDataURL") && card.includes("cancelWeChatLogin"), "WeChat card omits in-process QR rendering or cancellation");
assert(card.includes("function WeChatLogo") && card.includes("wechat-channel-icon") && !card.includes("<MessageSquare"), "WeChat card does not use its branded logo");
assert(card.includes("aria-expanded={expanded}") && card.includes("wechat-expand-button") && card.includes("expanded && <>"), "WeChat card is not collapsible");
assert(styles.includes(".channel-adapter-card-header .wechat-channel-icon") && styles.includes("background: #07c160"), "WeChat logo color can be overridden by generic header styles");
assert(card.includes("window.clearInterval") && card.includes("polling.current"), "WeChat card lacks polling cleanup or overlap protection");
assert(card.includes("remainingSeconds") && card.includes("getWeChatSessionSummary"), "WeChat card omits QR expiry countdown or session summary");
assert(!card.includes("wechat-model-policy") && !card.includes("Primary model") && !card.includes("Image understanding") && !card.includes("Image generation"), "WeChat card exposes implementation model assignments");
assert(!card.includes("localStorage") && !card.includes("bot_token"), "WeChat card persists or references secret material");
assert(chat.includes('data-testid={channelSource === "wechat" ? "send-to-wechat"') && chat.includes("confirmExternalSend: true"), "WeChat conversation lacks an explicit external-send action");
assert(chat.includes('trigger: "keyboard"') && chat.includes("decideWeChatComposerSubmit") && chat.includes("wechatConfirmationPending"), "ordinary composer shortcuts can bypass WeChat confirmation");
assert(windows.includes("bootstrapRuntimeSessionCatalog") && macosCatalog.includes("bootstrapRuntimeSessionCatalog"), "Desktop restart does not bootstrap pre-existing Runtime Sessions before consuming catalog events");

console.log("WeChat Desktop API, authenticated bridge, cross-platform IPC, channel catalog and QR lifecycle verification passed.");
