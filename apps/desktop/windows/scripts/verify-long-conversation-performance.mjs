import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const distDir = join(root, "out", "renderer");
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);
const executablePath = browserCandidates.find(existsSync);
assert.ok(existsSync(join(distDir, "index.html")), "Build the renderer before running the performance verifier.");
assert.ok(executablePath, "Chrome or Edge is required for the performance verifier.");

const mime = new Map([[".html", "text/html"], [".js", "text/javascript"], [".css", "text/css"], [".png", "image/png"], [".ttf", "font/ttf"]]);
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : normalize(pathname.replace(/^\/+/, ""));
  let file = resolve(distDir, relative);
  if (!file.startsWith(resolve(distDir)) || !existsSync(file) || statSync(file).isDirectory()) file = join(distDir, "index.html");
  response.writeHead(200, { "content-type": mime.get(extname(file)) || "application/octet-stream" });
  response.end(readFileSync(file));
});

await new Promise((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object");
const browser = await chromium.launch({ headless: true, executablePath });
const results = [];

async function openFixture(runs) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1&longConversationFixture=${runs}`, { waitUntil: "networkidle" });
  const enteredAt = Date.now();
  const enterButton = page.getByRole("button", { name: /进入开发者工作区|Enter developer workspace/ });
  if (await enterButton.count() && await enterButton.isVisible()) await enterButton.click();
  const fixtureThread = page.locator(".thread-item, .workspace-thread-item").filter({ hasText: `${runs}-turn Codex fixture` }).first();
  await fixtureThread.waitFor({ state: "visible" });
  await fixtureThread.click();
  try {
    await page.locator(".conversation-titlebar").waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    throw new Error(`Long-conversation fixture did not open. Visible text: ${(await page.locator("body").innerText()).slice(0, 1200)}`, { cause: error });
  }
  await page.locator(".message-list > .message").last().waitFor({ state: "visible" });
  await page.locator("textarea").last().waitFor({ state: "visible" });
  const readyMs = Date.now() - enteredAt;
  await page.waitForTimeout(450);
  return { page, readyMs };
}

async function togglePanel(page) {
  return page.evaluate(async () => {
    const button = document.querySelector(".chat-right-panel-float-toggle");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Right panel toggle is missing.");
    const started = performance.now();
    button.click();
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const panel = document.querySelector(".right-panel");
    if (!panel || panel.classList.contains("is-collapsed")) throw new Error("Right panel did not expand.");
    return performance.now() - started;
  });
}

async function collapsePanel(page) {
  await page.evaluate(async () => {
    const button = document.querySelector(".chat-right-panel-float-toggle");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Right panel toggle is missing.");
    button.click();
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    if (!document.querySelector(".right-panel.is-collapsed")) throw new Error("Right panel did not collapse while preserving its instance.");
  });
}

try {
  const sixty = await openFixture(60);
  const sixtyMessages = await sixty.page.locator(".message-list > .message").count();
  const sixtyRendered = await sixty.page.locator(".virtual-message-rendered").count();
  assert.equal(await sixty.page.locator(".right-panel:not(.is-collapsed)").count(), 0, "The collapsed right panel must not remain visibly mounted.");
  const sixtyScrollMetrics = await sixty.page.evaluate(async () => {
    const list = document.querySelector(".message-list");
    if (!(list instanceof HTMLElement)) throw new Error("Message list is unavailable.");
    const progressiveButton = document.querySelector(".load-earlier-history");
    if (progressiveButton) throw new Error("Long conversations must use the native scrollbar over the full message set.");
    list.scrollTop = 0;
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    const first = list.querySelector(".message[data-message-id]");
    list.scrollTop = list.scrollHeight - list.clientHeight;
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    return {
      firstMessageId: first instanceof HTMLElement ? first.dataset.messageId : null,
      clientHeight: list.clientHeight,
      scrollHeight: list.scrollHeight,
      scrollTop: list.scrollTop,
      maxScrollTop,
      thumbRatio: list.clientHeight / list.scrollHeight,
    };
  });
  const sixtyToggleMs = await togglePanel(sixty.page);
  const worktreeTab = sixty.page.locator(".files-worktree-switcher button").nth(1);
  await worktreeTab.click();
  await collapsePanel(sixty.page);
  await togglePanel(sixty.page);
  assert.equal(await worktreeTab.getAttribute("aria-selected"), "true", "Right panel state must survive collapse and re-open.");
  assert.equal(sixtyMessages, 120, `60-turn fixture must mount the full message set; mounted ${sixtyMessages}.`);
  assert.ok(sixtyRendered <= 40, `60-turn fixture rendered ${sixtyRendered} heavy messages.`);
  assert.equal(sixtyScrollMetrics.firstMessageId, "long-user-1", "Dragging to the top must reach the first message.");
  assert.ok(sixtyScrollMetrics.thumbRatio < 0.15, `60-turn native scrollbar ratio is too large: ${sixtyScrollMetrics.thumbRatio.toFixed(3)}.`);
  assert.ok(Math.abs(sixtyScrollMetrics.scrollTop - sixtyScrollMetrics.maxScrollTop) <= 2, "Dragging to the bottom must reach the latest message boundary.");
  assert.ok(sixtyToggleMs < 100, `60-turn right panel response took ${sixtyToggleMs.toFixed(1)}ms.`);
  results.push({ runs: 60, readyMs: sixty.readyMs, messages: sixtyMessages, rendered: sixtyRendered, scroll: sixtyScrollMetrics, toggleMs: sixtyToggleMs });
  await sixty.page.close();

  const fiveHundred = await openFixture(500);
  const fiveHundredMessages = await fiveHundred.page.locator(".message-list > .message").count();
  const fiveHundredRendered = await fiveHundred.page.locator(".virtual-message-rendered").count();
  const fiveHundredScrollRatio = await fiveHundred.page.evaluate(() => {
    const list = document.querySelector(".message-list");
    if (!(list instanceof HTMLElement)) throw new Error("Message list is unavailable.");
    if (document.querySelector(".load-earlier-history")) throw new Error("500-turn fixture still exposes progressive history loading.");
    return list.clientHeight / list.scrollHeight;
  });
  const fiveHundredToggleMs = await togglePanel(fiveHundred.page);
  assert.equal(fiveHundredMessages, 1000, "500-turn fixture must expose the full native-scroll message set.");
  assert.ok(fiveHundredRendered <= 40, `Virtualization retained ${fiveHundredRendered} heavy messages for 500 turns.`);
  assert.ok(fiveHundredScrollRatio < 0.03, `500-turn native scrollbar ratio is too large: ${fiveHundredScrollRatio.toFixed(3)}.`);
  assert.ok(fiveHundredToggleMs < 100, `500-turn right panel response took ${fiveHundredToggleMs.toFixed(1)}ms.`);
  results.push({ runs: 500, readyMs: fiveHundred.readyMs, messages: fiveHundredMessages, rendered: fiveHundredRendered, scrollRatio: fiveHundredScrollRatio, toggleMs: fiveHundredToggleMs });
  await fiveHundred.page.close();
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

console.log(`Long conversation performance verification passed: ${JSON.stringify(results)}`);
