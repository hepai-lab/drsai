import assert from "node:assert/strict";

import { formatWebSearchActivitySummary } from "../../shared/renderer/src/webSearchPresentation.ts";

assert.equal(
  formatWebSearchActivitySummary({ status: "running", input: { query: "HEPiX 2026" } }, "zh"),
  "正在搜索并读取网络来源：HEPiX 2026",
);
assert.equal(
  formatWebSearchActivitySummary({
    status: "completed",
    output: { content: JSON.stringify({ results: [{ url: "https://one.example" }, { url: "https://two.example" }] }) },
  }, "zh"),
  "已找到 2 个结果",
);
assert.equal(
  formatWebSearchActivitySummary({ status: "completed", output: { results: [] } }, "zh"),
  "未找到可靠结果",
);
assert.equal(formatWebSearchActivitySummary({ status: "error" }, "zh"), "网络搜索失败");
assert.equal(formatWebSearchActivitySummary({ status: "cancelled" }, "zh"), "网络搜索已取消");
assert.equal(formatWebSearchActivitySummary({ status: "running" }, "en"), "Searching and reading web sources");

console.log("OpenDrSai WebSearch P1 presentation verification passed.");
