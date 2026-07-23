import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const sharedApi = read("../shared/api/desktopApi.ts");
const main = read("src/main/index.ts");
const share = read("src/main/threadShare.ts");
const css = read("../shared/renderer/src/styles.css");
const shell = read("../shared/renderer/src/components/WorkspaceShell.tsx");
const mock = read("../shared/renderer/src/mockDesktopApi.ts");
const preload = read("../shared/main/preload.ts");
const client = read("../shared/renderer/src/threadShareClient.ts");

const checks = [
  [
    "share menu item exists",
    shell.includes("分享对话") && shell.includes("Share conversation") && shell.includes("openShareDialog"),
  ],
  [
    "share dialog is read-only",
    shell.includes("thread-share-dialog") &&
      shell.includes("只能查看聊天记录") &&
      shell.includes("复制链接") &&
      shell.includes("打开预览") &&
      !shell.includes("打开文件位置") &&
      !shell.includes("参考豆包分享") &&
      shell.includes("ChatMessageContent") &&
      shell.includes("getAssistantVisibleAnswer") &&
      shell.includes("复制成功") &&
      shell.includes("复制失败"),
  ],
  [
    "shared share html omits thinking blocks",
    (() => {
      const html = read("../shared/api/threadShareHtml.ts");
      const mainShare = read("src/main/threadShare.ts");
      return (
        html.includes("stripThinkBlocks") &&
        html.includes("markdownToShareHtml") &&
        html.includes("expandCollapsedMarkdownTables") &&
        html.includes('class="content markdown"') &&
        html.includes(".table-wrap") &&
        html.includes('if (part.type === "reasoning") return ""') &&
        mainShare.includes("reasoningContent: undefined") &&
        mainShare.includes('part.type !== "reasoning"') &&
        mainShare.includes("toolTimeline: undefined")
      );
    })(),
  ],
  [
    "copy uses trusted clipboard ipc fallback",
    client.includes("copyTextToClipboard") &&
      client.includes("copyTextReliable") &&
      client.includes("publicShareUrl") &&
      main.includes("desktop:clipboard-copy-text") &&
      preload.includes("copyTextToClipboard:") &&
      sharedApi.includes("copyTextToClipboard(text: string)"),
  ],
  [
    "shared api contract",
    sharedApi.includes("CreateThreadShareRequest") &&
      sharedApi.includes("DesktopThreadShareResult") &&
      sharedApi.includes("createThreadShare(") &&
      sharedApi.includes("readOnly: true"),
  ],
  [
    "main generates readonly html",
    (() => {
      const share = read("src/main/threadShare.ts");
      const html = read("../shared/api/threadShareHtml.ts");
      return (
        html.includes("只读分享") &&
        html.includes("无法发起新对话") &&
        html.includes("--app-accent: #8b5cf6") &&
        share.includes("renderThreadShareHtml") &&
        share.includes("createThreadShare") &&
        share.includes("publishShareViaGfs") &&
        share.includes("gfsWrite(") &&
        share.includes("text/html; charset=utf-8") &&
        share.includes("public-share-cache.json") &&
        share.includes("publicShareUrl") &&
        share.includes("isUsablePublicShareUrl") &&
        !share.includes("publishShareToWebUi") &&
        !html.includes("<textarea") &&
        !html.includes("contenteditable")
      );
    })(),
  ],
  [
    "renderer falls back when bridge missing",
    client.includes("hasThreadShareBridge") &&
      client.includes('mode: "local"') &&
      client.includes("URL.createObjectURL"),
  ],
  [
    "ipc preload mock wired",
    main.includes("desktop:create-thread-share") &&
      preload.includes("createThreadShare:") &&
      mock.includes("createThreadShare:") &&
      mock.includes("openThreadShare:") &&
      mock.includes("revealThreadShare:"),
  ],
  [
    "styles present",
    css.includes(".thread-share-dialog") &&
      css.includes(".thread-share-primary") &&
      css.includes("var(--app-accent)"),
  ],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  console.error("Thread share verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Thread share verification passed (${checks.length} checks).`);
