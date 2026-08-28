import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const distDir = join(root, "out", "renderer");
const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
assert.ok(existsSync(join(distDir, "index.html")), "Build the renderer before running the Files linkage benchmark.");
assert.ok(chromePath, "Chrome or Edge is required for the Files linkage benchmark.");

const types = new Map([[".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".svg", "image/svg+xml"]]);
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : normalize(pathname.replace(/^\/+/, ""));
  let path = resolve(distDir, relative);
  if (!path.startsWith(resolve(distDir)) || !existsSync(path) || statSync(path).isDirectory()) path = join(distDir, "index.html");
  response.writeHead(200, { "Content-Type": types.get(extname(path)) || "application/octet-stream" });
  response.end(readFileSync(path));
});

await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address === "object");
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.addInitScript(() => localStorage.setItem("opendrsai:first-run-complete:v3", "true"));
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1&conversationResourceFixture=1`, { waitUntil: "networkidle" });
  const bypass = page.getByRole("button", { name: /进入开发者工作区|Enter developer workspace/ });
  if (await bypass.isVisible().catch(() => false)) await bypass.click();
  const thread = page.getByText("P2 resource fixture", { exact: true }).first();
  if (await thread.isVisible().catch(() => false)) await thread.click();
  const chip = page.getByRole("button", { name: /打开资源: 引用资料\.md|Open resource: 引用资料\.md/ });
  await chip.waitFor({ state: "visible" });

  await page.evaluate(() => {
    const api = window.openDrSai;
    if (!api) throw new Error("mock Desktop API missing");
    const original = api.previewConversationResource.bind(api);
    let sequence = 0;
    api.previewConversationResource = async request => {
      const preview = await original(request);
      sequence += 1;
      return { ...preview, content: `P2 Files preview sample ${sequence}`, metadata: { ...preview.metadata, benchmarkSequence: sequence } };
    };
  });

  const samples = [];
  for (let index = 1; index <= 100; index += 1) {
    const started = performance.now();
    await chip.click();
    await page.locator(".files-context-preview").getByText(`P2 Files preview sample ${index}`, { exact: true }).waitFor({ state: "visible" });
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  assert.ok(p95 <= 150, `Local Files selection+preview P95 ${p95.toFixed(1)} ms exceeded 150 ms.`);
  assert.equal(await page.locator(".files-context-preview").getByText("P2 Files preview sample 100", { exact: true }).count(), 1);
  console.log(`Desktop P2 Files selection+preview passed (100 samples, P95 ${p95.toFixed(1)} ms).`);
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
