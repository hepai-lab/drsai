import {
  extractShareConclusion,
  markdownToShareHtml,
  renderThreadShareHtml,
} from "../src/shared/threadShareHtml.ts";

const content = [
  "<think>",
  "The user is asking which workspace.",
  "用户想知道我当前在哪个工作区下。",
  "</think>",
  "",
  "当前工作目录信息如下：",
  "",
  "**你的项目工作目录：**",
  "```",
  "D:\\测试\\11",
  "```",
  "",
  "**DrSai 内部存储空间：**",
  "```",
  "C:\\Users\\servi\\.drsai\\workspace\\runs\\1e3da1ff",
  "```",
  "",
  "用户想知道我当前在哪个工作区下。系统提示里有工作区相关信息。",
].join("\n");

const conclusion = extractShareConclusion(content, "The user is asking which workspace.");
const html = renderThreadShareHtml({
  shareId: "t",
  title: "x",
  createdAt: new Date().toISOString(),
  messages: [{ id: "1", role: "assistant", content }],
});

const checks = {
  noThinkTagInConclusion: !/<think|用户想知道/.test(conclusion),
  hasAnswer: conclusion.includes("当前工作目录信息如下"),
  mdHasStrong: markdownToShareHtml(conclusion).includes("<strong>"),
  mdHasPre: markdownToShareHtml(conclusion).includes("<pre>"),
  htmlHasOpenDrSaiAuthor: html.includes("OpenDrSai") && html.includes('class="role"'),
  htmlMatchesAppStyle: html.includes("--app-accent: #8b5cf6") && html.includes("brand-mark"),
  htmlNoRawStars: !html.includes("**你的项目"),
  htmlNoThink: !/<think|用户想知道我当前/.test(html),
  formatVersion: html.includes("conclusion-md-v3"),
};

console.log(JSON.stringify({ conclusion, checks }, null, 2));
if (Object.values(checks).some((ok) => !ok)) process.exit(1);
