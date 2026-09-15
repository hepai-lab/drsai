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
assert(existsSync(join(dist, "index.html")), "Build the production Renderer before running the result-first verifier.");
assert(executablePath, "Chrome or Edge is required for the result-first production Renderer verifier.");

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1&resultFirstCompletion=1`, { waitUntil: "networkidle" });
  const enter = page.getByRole("button", { name: /Enter developer workspace|进入开发者工作区/ });
  if (await enter.count()) await enter.click();
  const panel = page.getByTestId("task-delivery-summary");
  await panel.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await panel.getAttribute("data-status"), "completed");
  assert.equal(await panel.getAttribute("data-target-id"), "mock-result-first-completion");
  const text = (await panel.innerText()).replace(/\s+/g, " ");
  assert.match(text, /requested result is ready/i, "core result must be visible first");
  assert.match(text, /Review the result/i, "next action must be visible");
  assert.match(text, /External HAI release evidence/i, "incomplete item must remain visible");
  assert.equal(await page.locator(".run-inspector-panel, .debug-panel").count(), 0, "ordinary result disclosure must not require diagnostics");
  await page.close();
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
console.log("OpenDrSai result-first production Renderer verification passed: running -> completed -> automatic delivery card.");
