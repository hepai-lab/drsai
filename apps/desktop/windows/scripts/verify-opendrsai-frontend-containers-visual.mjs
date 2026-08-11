import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const dist = join(root, "out", "renderer");
const executablePath = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean).find(existsSync);
assert(executablePath && existsSync(join(dist, "index.html")), "Build the production Renderer and install Chrome or Edge first.");

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
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1`, { waitUntil: "networkidle" });
  const enter = page.getByTestId("developer-workspace-login");
  if (await enter.count()) await enter.click();
  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.getByTestId("first-run-setup").count(), 0);
  assert.deepEqual(runtimeErrors, []);
  const evidenceDir = join(root, "release", "product-evidence", "frontend-containers");
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: join(evidenceDir, "production-renderer-direct-shell.png"), fullPage: true });
  await page.close();

  const shellPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  shellPage.on("pageerror", (error) => runtimeErrors.push(error.message));
  await shellPage.addInitScript(() => localStorage.setItem("opendrsai:first-run-complete:v3", "true"));
  await shellPage.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1&operationalStateFixture=1`, { waitUntil: "networkidle" });
  const shellEnter = shellPage.getByTestId("developer-workspace-login");
  if (await shellEnter.count()) await shellEnter.click();
  await shellPage.locator(".app-shell").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await shellPage.evaluate(() => window.openDrSai?.isOperationalStateE2eEnabled()), true, "operational-state fixture bridge is disabled");
  const diagnostic = shellPage.getByTestId("operational-state-bar");
  const facts = { identity: "authenticated", runtime: "ready", model: "unconfigured", workspace: "none" };
  for (let attempt = 0; attempt < 20 && !(await diagnostic.count()); attempt += 1) {
    await shellPage.evaluate((detail) => window.dispatchEvent(new CustomEvent("drsai:e2e-operational-state", { detail })), facts);
    await shellPage.waitForTimeout(100);
  }
  assert.equal(await diagnostic.count(), 1, `diagnostics container missing; observed=${await shellPage.evaluate(() => `${document.documentElement.dataset.operationalE2eState || "none"}/${document.documentElement.dataset.operationalE2eDecision || "none"}`)} actions=${await shellPage.locator(".conversation-titlebar-actions").evaluate((node) => node.innerHTML).catch(() => "missing")} errors=${JSON.stringify(runtimeErrors)} body=${(await shellPage.locator("body").innerText()).slice(0, 1000)}`);
  assert.equal(await diagnostic.getAttribute("data-current-layer"), "model");
  await diagnostic.getByTestId("operational-primary-action").click();
  const recoveryMessage = diagnostic.getByTestId("operational-action-message");
  await recoveryMessage.waitFor({ state: "visible", timeout: 10000 });
  assert.match(await recoveryMessage.innerText(), /minimal call|最小调用/);
  assert.equal(await shellPage.getByTestId("model-provider-settings").count(), 0);
  const resultsLink = shellPage.getByText(/Results Library|成果库/, { exact: true }).first();
  await resultsLink.click();
  await shellPage.locator(".results-center-view").waitFor({ state: "visible", timeout: 10000 });
  assert.deepEqual(runtimeErrors, []);
  await shellPage.screenshot({ path: join(evidenceDir, "production-renderer-container-shell.png"), fullPage: true });
  await shellPage.close();
  console.log(JSON.stringify({
    ok: true,
    productionRenderer: true,
    firstRunSetupAbsent: true,
    diagnosticsRecoveryTestedSelectedModelInline: true,
    resultsContainerVisible: true,
    taskShellVisible: true,
    runtimeErrors: 0,
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
