import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const dist = join(root, "out", "renderer");
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);
const executablePath = browserCandidates.find(existsSync);
assert(existsSync(join(dist, "index.html")), "Build the production renderer before running the Experiment gate visual verifier.");
assert(executablePath, "Chrome or Edge is required for the Experiment gate visual verifier.");

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

async function inspectGate(state) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => window.localStorage.setItem("opendrsai:first-run-complete:v3", "true"));
  const gate = state === "passed" ? "&experimentReleaseGate=passed" : "";
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1${gate}`, { waitUntil: "networkidle" });
  const enter = page.getByRole("button", { name: /Enter developer workspace|进入开发者工作区/ });
  if (await enter.count()) await enter.click();
  const composer = page.getByTestId("composer-input");
  await composer.waitFor({ state: "visible" });
  await composer.fill("__STRUCTURED_VISUAL_FIXTURE__");
  await composer.locator("xpath=ancestor::form[1]").locator("button.composer-submit:not(.stop)").first().click();
  const turn = page.locator('.structured-message-parts[data-turn-status="completed"]').last();
  await turn.waitFor({ state: "visible" });
  const process = turn.locator(".structured-process");
  if (!(await process.evaluate((node) => node.hasAttribute("open")))) await process.locator("summary").click();
  await page.waitForTimeout(100);
  const buttons = await turn.getByRole("button", { name: /Create experiment|创建实验/ }).count();
  await page.close();
  return buttons;
}

try {
  assert.equal(await inspectGate("incomplete"), 0, "Experiment entry must be absent while any P2 release evidence is incomplete.");
  assert.ok(await inspectGate("passed") >= 1, "Experiment entry must become available after all four release features pass.");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
console.log("OpenDrSai Experiment release gate production Renderer verification passed: incomplete=hidden, complete=visible.");
