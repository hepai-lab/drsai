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
assert(existsSync(join(dist, "index.html")), "Build the production Renderer before running the result provenance verifier.");
assert(executablePath, "Chrome or Edge is required for the result provenance verifier.");

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
  await page.addInitScript(() => window.localStorage.setItem("opendrsai:first-run-complete:v3", "true"));
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1&resultProvenance=1`, { waitUntil: "networkidle" });
  const enter = page.getByRole("button", { name: /Enter developer workspace|进入开发者工作区/ });
  if (await enter.count()) await enter.click();
  const fixtureProbe = await page.evaluate(async () => ({ search: window.location.search, tasks: await window.openDrSai.listBackgroundTasks({ limit: 100 }) }));
  assert.equal(fixtureProbe.tasks[0]?.id, "mock-result-provenance-task", `production fixture was not activated: ${JSON.stringify(fixtureProbe)}`);
  const delivery = page.getByTestId("task-delivery-summary");
  if (await delivery.count()) await delivery.getByRole("button", { name: /Close|关闭/ }).click();
  await page.locator('[data-nav-id="results"]').click();
  const resultsView = page.getByTestId("results-center-view");
  await resultsView.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(1200);
  await resultsView.getByRole("button", { name: /All workspaces|全部工作区/ }).click();
  const card = page.locator('.results-task-index li[data-artifact-id="mock-result-provenance-artifact"]');
  assert.equal(await card.count(), 1, `result card is missing from Results Library: ${await resultsView.innerText()}`);
  await card.waitFor({ state: "visible", timeout: 10000 });
  const provenance = card.getByTestId("results-provenance");
  assert.equal(await provenance.count(), 1, `result provenance details are missing from the production Renderer card: ${await card.innerText()}`);
  assert.equal(await provenance.getAttribute("data-source-task-id"), "mock-result-provenance-task");
  assert.equal(await provenance.getAttribute("data-source-session-id"), "mock-result-provenance-session");
  assert.equal(await provenance.getAttribute("data-source-run-id"), "mock-result-provenance-run");
  assert.equal(await provenance.getAttribute("data-target-version"), "3");
  assert.match(await provenance.getAttribute("data-source-digest"), /^sha256:[a-f0-9]{64}$/);
  await provenance.locator("summary").click();
  const details = (await provenance.innerText()).replace(/\s+/g, " ");
  assert.match(details, /Summarize the verified workspace materials/i);
  assert.match(details, /research-notes\.pdf/);
  assert.match(details, /measurements\.csv/);
  assert.doesNotMatch(details, /C:\\Users\\Demo/i, "public provenance details must not expose an absolute path");
  await provenance.getByTestId("results-verify-provenance").click();
  const status = provenance.getByTestId("results-provenance-status");
  await status.waitFor({ state: "visible" });
  assert.equal(await status.getAttribute("data-state"), "verified");
  assert.match(await status.innerText(), /来源摘要已验证|Provenance verified/i);

  await provenance.getByTestId("results-open-source-run").click();
  const inspector = page.locator('.run-inspector-panel[data-run-id="mock-result-provenance-run"]');
  await inspector.waitFor({ state: "visible", timeout: 10000 });

  await page.locator('[data-nav-id="results"]').click();
  const reopened = page.locator('.results-task-index li[data-artifact-id="mock-result-provenance-artifact"]');
  const reopenedProvenance = reopened.getByTestId("results-provenance");
  if (!await reopenedProvenance.evaluate((node) => node.hasAttribute("open"))) await reopenedProvenance.locator("summary").click();
  await reopened.getByTestId("results-open-source-task").click();
  const sourceTaskPanel = page.getByTestId("task-delivery-summary");
  await sourceTaskPanel.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await sourceTaskPanel.getAttribute("data-target-id"), "mock-result-provenance-request");
  assert.match(await sourceTaskPanel.innerText(), /Verified workspace research summary/i);

  console.log(JSON.stringify({ ok: true, taskNavigation: true, runNavigation: true, digestVerified: true, targetVersion: 3, publicAbsolutePaths: 0 }, null, 2));
  await page.close();
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
