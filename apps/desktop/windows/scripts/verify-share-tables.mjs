import {
  expandCollapsedMarkdownTables,
  markdownToShareHtml,
} from "../src/shared/threadShareHtml.ts";

const proper = `| 场景 | 举例 |
| ------ | ------ |
| 代码开发 | 写代码、改 Bug、重构、代码审查 |
| 数据分析 | 处理 CSV/JSON、统计分析、可视化 |
| 文件处理 | 批量重命名、格式转换、内容提取 |`;

const collapsed =
  "| 场景 | 举例 | | ------ | ------ | | 代码开发 | 写代码、改 Bug、重构、代码审查 | | 数据分析 | 处理 CSV/JSON、统计分析、可视化 | | 文件处理 | 批量重命名、格式转换、内容提取 | | 学术研究 | 文献搜索、论文辅助 | | 自动化 | 脚本编写、任务自动化 |";

const properHtml = markdownToShareHtml(`### 我能帮你做什么？\n\n${proper}\n\n有什么具体的任务想让我帮你处理吗？`);
const collapsedHtml = markdownToShareHtml(`### 我能帮你做什么？\n\n${collapsed}\n\n有什么具体的任务想让我帮你处理吗？`);
const expanded = expandCollapsedMarkdownTables(collapsed);

const checks = {
  properHasTable: properHtml.includes("<table>") && properHtml.includes("<th>"),
  properHasRow: properHtml.includes("代码开发"),
  properNoRawPipes: !properHtml.includes("| 场景 |"),
  expandedHasNewlines: expanded.includes("\n|"),
  collapsedHasTable: collapsedHtml.includes("<table>") && collapsedHtml.includes("<td>"),
  collapsedHasAcademic: collapsedHtml.includes("学术研究"),
  collapsedNoRawSeparator: !collapsedHtml.includes("| ------ |"),
};

console.log(JSON.stringify({ checks, expandedPreview: expanded.slice(0, 180) }, null, 2));
if (Object.values(checks).some((ok) => !ok)) process.exit(1);
