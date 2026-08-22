import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const dist = join(root, "out", "renderer");
const candidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);
const executablePath = candidates.find(existsSync);
assert(existsSync(join(dist, "index.html")), "Build the production Renderer before running the 10k process verifier.");
assert(executablePath, "Chrome or Edge is required for the 10k process verifier.");

const mime = new Map([[".html", "text/html"], [".js", "text/javascript"], [".css", "text/css"], [".png", "image/png"], [".ttf", "font/ttf"]]);
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : normalize(pathname.replace(/^\/+/, ""));
  let path = resolve(dist, relative);
  if (!path.startsWith(resolve(dist)) || !existsSync(path) || statSync(path).isDirectory()) path = join(dist, "index.html");
  response.writeHead(200, { "content-type": mime.get(extname(path)) || "application/octet-stream" });
  response.end(readFileSync(path));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert(address && typeof address === "object");
const browser = await chromium.launch({ headless: true, executablePath });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    window.localStorage.setItem("opendrsai:first-run-complete:v3", "true");
    window.localStorage.setItem("opendrsai.lastThread", "mock-structured-activity-thread");
  });
  const started = performance.now();
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1&structuredActivityItems=10000`, { waitUntil: "networkidle" });
  const enter = page.getByRole("button", { name: /Enter developer workspace|进入开发者工作区/ });
  if (await enter.count()) await enter.click();
  const fixtureThread = page.locator(".thread-item, .workspace-thread-item").filter({ hasText: "10,000-item process fixture" }).first();
  await fixtureThread.waitFor({ state: "visible", timeout: 10000 });
  await fixtureThread.click();
  const turn = page.locator('.structured-message-parts[data-turn-id="mock-structured-activity-run"]');
  await turn.waitFor({ state: "visible", timeout: 10000 });
  const firstPaintMs = performance.now() - started;
  const process = turn.locator(".structured-process");
  const result = turn.locator(".structured-result-layer");
  const approval = turn.locator(".structured-interaction-layer");
  const composerApproval = page.getByTestId("composer-agent-interaction");
  assert.match(await result.innerText(), /Core result[\s\S]*requested report is ready/i, "core result must be visible on first paint");
  assert.match(await approval.innerText(), /action is required|等待你的操作/i, "pending approval indicator must remain visible");
  assert.match(await composerApproval.innerText(), /Approve publishing the generated report/i, "pending approval controls must remain actionable in the composer");
  assert.equal(await process.evaluate((node) => node.hasAttribute("open")), false, "completed process must start collapsed");
  assert.equal(await process.locator('[data-testid="structured-process-content"]').count(), 0, "collapsed process must not mount evidence rows");
  assert.equal(await page.evaluate(() => {
    const process = document.querySelector('.structured-message-parts[data-turn-id="mock-structured-activity-run"] .structured-process');
    const approval = document.querySelector('.structured-message-parts[data-turn-id="mock-structured-activity-run"] .structured-interaction-layer');
    return Boolean(process && approval && !process.contains(approval));
  }), true, "approval must live outside the collapsible process layer");

  await process.locator("summary").click();
  const content = process.locator('[data-testid="structured-process-content"]');
  await content.waitFor({ state: "visible" });
  assert.equal(await content.locator(".structured-activity-row").count(), 16, "expanded process must mount one bounded activity window");
  assert.equal(await content.locator(".structured-activity-timeline").getAttribute("data-activity-count"), "10000");
  const openedDomItems = await turn.locator(".structured-activity-row, .structured-process-window-item").count();
  assert.ok(openedDomItems <= 200, `bounded process DOM exceeded 200 items: ${openedDomItems}`);
  assert.match(await content.locator(".structured-process-pagination").last().innerText(), /1–16[^\d]+10,?000|1–16 \/ 10000/i);

  await content.getByRole("button", { name: /Last|末页/ }).last().click();
  const activityWindow = content.locator(".structured-activity-window");
  assert.equal(await activityWindow.getAttribute("data-activity-window-start"), "9984");
  assert.equal(await activityWindow.getAttribute("data-activity-window-end"), "10000");
  assert.equal(await activityWindow.locator(".structured-activity-row").count(), 16);
  assert.equal(await activityWindow.locator(".structured-activity-row.error").count(), 1, "last-page failure evidence must remain reachable");
  assert.match(await composerApproval.innerText(), /Approve publishing/i, "paging evidence must not hide approval");
  assert.ok(firstPaintMs < 3000, `10k core result first paint exceeded 3s: ${firstPaintMs.toFixed(1)}ms`);
  console.log(JSON.stringify({ ok: true, firstPaintMs: Number(firstPaintMs.toFixed(1)), totalItems: 10_000, mountedEvidenceItems: openedDomItems, activityRows: 16, lastWindow: [9984, 10000], approvalOutsideProcess: true }, null, 2));
  await page.close();
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
