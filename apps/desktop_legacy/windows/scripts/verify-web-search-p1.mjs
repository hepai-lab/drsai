import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(appRoot, "..", "..", "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");

const gateway = read("cores/python/packages/drsai/src/drsai/backend/gateway.py");
const search = read("cores/python/packages/drsai/src/drsai/backend/runtime/web_search/bing_playwright.py");
const safety = read("cores/python/packages/drsai/src/drsai/backend/runtime/web_search/url_safety.py");
const tool = read("cores/python/packages/drsai/src/drsai/backend/runtime/web_search/tool.py");
const kernel = read("cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py");
const renderer = read("apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx");
const presentation = read("apps/desktop/shared/renderer/src/webSearchPresentation.ts");
const settings = read("apps/desktop/shared/renderer/src/App.tsx");
const developerBootstrap = read("apps/desktop/windows/scripts/dev.ps1");
const pyproject = read("cores/python/packages/drsai/pyproject.toml");

assert.match(gateway, /builtin\.web-search/);
assert.match(gateway, /create_web_search_tool\(\)/);
assert.match(tool, /class WebSearchTool/);
assert.match(tool, /ge=1, le=10/);
assert.match(search, /accept_downloads=False/);
assert.match(search, /permissions=\[\]/);
assert.match(search, /chromium_sandbox=True/);
assert.match(search, /max_total_content_chars: int = 24_000/);
assert.match(search, /asyncio\.wait_for/);
assert.match(safety, /address\.is_global/);
assert.match(safety, /web_search_url_private_denied/);
assert.doesNotMatch(search, /apps[./\\]webui/);
assert.doesNotMatch(kernel, /hepix/i, "retrieval policy must not contain incident-specific fixtures");
assert.match(renderer, /formatWebSearchActivitySummary/);
assert.match(renderer, /activity\.toolName !== "web_search"/, "WebSearch activity rows must not show elapsed time");
assert.match(presentation, /正在搜索并读取网络来源/);
assert.match(presentation, /已找到 \$\{results\} 个结果/);
assert.match(settings, /builtin\.web-search/);
assert.match(settings, /网络搜索/);
assert.match(pyproject, /playwright==1\.51/);
assert.match(developerBootstrap, /import drsai, playwright/);
assert.match(developerBootstrap, /web_search_runtime_status/);

console.log("OpenDrSai WebSearch P1 source and Desktop UX verification passed.");
