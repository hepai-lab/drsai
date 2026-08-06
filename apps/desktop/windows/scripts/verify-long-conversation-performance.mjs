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
  await page.addInitScript(() => {
    window.localStorage.setItem("opendrsai:first-run-complete:v3", "true");
    window.localStorage.setItem("opendrsai.lastThread", "mock-long-opendrsai-thread");
  });
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1&longConversationFixture=${runs}&activeDeltaFixture=1`, { waitUntil: "networkidle" });
  const enteredAt = Date.now();
  const enterButton = page.getByRole("button", { name: /进入开发者工作区|Enter developer workspace/ });
  if (await enterButton.count() && await enterButton.isVisible()) await enterButton.click();
  const fixtureThread = page.locator(".thread-item, .workspace-thread-item").filter({ hasText: `${runs}-turn OpenDrSai fixture` }).first();
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
    const button = document.querySelector('[data-testid="titlebar-right-panel-toggle"]');
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
    const button = document.querySelector('[data-testid="titlebar-right-panel-toggle"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("Right panel toggle is missing.");
    button.click();
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    if (!document.querySelector(".right-panel.is-collapsed")) throw new Error("Right panel did not collapse while preserving its instance.");
  });
}

async function benchmarkPanelClicks(page, count = 100) {
  return page.evaluate(async (iterations) => {
    const button = document.querySelector('[data-testid="titlebar-right-panel-toggle"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("Right panel toggle is missing.");
    const samples = [];
    for (let index = 0; index < iterations; index += 1) {
      const before = document.querySelector(".right-panel")?.classList.contains("is-collapsed");
      const started = performance.now();
      button.click();
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      const after = document.querySelector(".right-panel")?.classList.contains("is-collapsed");
      if (before === after) throw new Error(`Right panel click ${index + 1} was lost.`);
      samples.push(performance.now() - started);
    }
    return samples;
  }, count);
}

function percentile(values, ratio) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)] ?? 0;
}

try {
  const sixty = await openFixture(59);
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
  assert.equal(sixtyMessages, 118, `59-turn fixture must mount the full message set; mounted ${sixtyMessages}.`);
  assert.ok(sixtyRendered <= 40, `59-turn fixture rendered ${sixtyRendered} heavy messages.`);
  assert.equal(sixtyScrollMetrics.firstMessageId, "long-user-1", "Dragging to the top must reach the first message.");
  assert.ok(sixtyScrollMetrics.thumbRatio < 0.15, `60-turn native scrollbar ratio is too large: ${sixtyScrollMetrics.thumbRatio.toFixed(3)}.`);
  assert.ok(Math.abs(sixtyScrollMetrics.scrollTop - sixtyScrollMetrics.maxScrollTop) <= 2, "Dragging to the bottom must reach the latest message boundary.");
  assert.ok(sixtyToggleMs < 100, `59-turn right panel response took ${sixtyToggleMs.toFixed(1)}ms.`);
  results.push({ runs: 59, readyMs: sixty.readyMs, messages: sixtyMessages, rendered: sixtyRendered, scroll: sixtyScrollMetrics, toggleMs: sixtyToggleMs });
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
  const patchStability = await fiveHundred.page.evaluate(async () => {
    const list = document.querySelector(".message-list");
    const composer = document.querySelector("textarea");
    if (!(list instanceof HTMLElement) || !(composer instanceof HTMLTextAreaElement)) throw new Error("Chat controls are unavailable.");
    list.scrollTop = Math.floor((list.scrollHeight - list.clientHeight) * 0.35);
    const before = list.scrollTop;
    composer.focus();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const liveInsideMessages = list.querySelectorAll("[aria-live]").length;
    return { focusPreserved: document.activeElement === composer, scrollShift: Math.abs(list.scrollTop - before), liveInsideMessages };
  });
  const fiveHundredToggleMs = await togglePanel(fiveHundred.page);
  const activeDeltaClickSamples = await benchmarkPanelClicks(fiveHundred.page, 100);
  const activeDeltaClickP95Ms = percentile(activeDeltaClickSamples, 0.95);
  assert.equal(fiveHundredMessages, 1000, "500-turn fixture must expose the full native-scroll message set.");
  assert.ok(fiveHundredRendered <= 40, `Virtualization retained ${fiveHundredRendered} heavy messages for 500 turns.`);
  assert.ok(fiveHundredScrollRatio < 0.03, `500-turn native scrollbar ratio is too large: ${fiveHundredScrollRatio.toFixed(3)}.`);
  assert.ok(fiveHundredToggleMs < 100, `500-turn right panel response took ${fiveHundredToggleMs.toFixed(1)}ms.`);
  assert.equal(patchStability.focusPreserved, true, "streaming patches must not steal Composer focus");
  assert.ok(patchStability.scrollShift <= 2, `streaming patches forced scroll by ${patchStability.scrollShift}px while the user was away from the bottom`);
  assert.equal(patchStability.liveInsideMessages, 0, "message deltas must not create noisy ARIA live regions");
  assert.ok(activeDeltaClickP95Ms < 100, `500-turn active-delta right panel P95 took ${activeDeltaClickP95Ms.toFixed(1)}ms.`);
  assert.equal(activeDeltaClickSamples.length, 100, "All 100 right-panel clicks must be observed during active streaming.");
  results.push({ runs: 500, readyMs: fiveHundred.readyMs, messages: fiveHundredMessages, rendered: fiveHundredRendered, scrollRatio: fiveHundredScrollRatio, toggleMs: fiveHundredToggleMs, activeDeltaClickP95Ms, patchStability });
  await fiveHundred.page.close();
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

console.log(`Long conversation performance verification passed: ${JSON.stringify(results)}`);
