import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const distDir = join(root, "out", "renderer");
const evidenceDir = join(root, "out", "verification", "structured-visual");
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);
const chromePath = browserCandidates.find((candidate) => existsSync(candidate));

assert.ok(existsSync(join(distDir, "index.html")), "Build the renderer before running structured visual verification.");
assert.ok(chromePath, `Chrome or Edge executable not found. Checked: ${browserCandidates.join(", ")}`);
mkdirSync(evidenceDir, { recursive: true });

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  const relativePath = pathname === "/" ? "index.html" : normalize(pathname.replace(/^\/+/, ""));
  let filePath = resolve(distDir, relativePath);
  if (!filePath.startsWith(resolve(distDir)) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, "index.html");
  }
  response.writeHead(200, { "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream" });
  response.end(readFileSync(filePath));
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
const results = [];
let accessibility = null;

try {
  await page.addInitScript(() => {
    window.localStorage.setItem("opendrsai:first-run-complete:v3", "true");
  });
  await page.goto(`${baseUrl}?structuredVisualFixture=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /进入开发者工作区|Enter developer workspace/ }).click();
  const composer = page.getByTestId("composer-input");
  await composer.waitFor({ state: "visible" });
  await composer.fill("__STRUCTURED_VISUAL_FIXTURE__");
  const composerForm = composer.locator("xpath=ancestor::form[1]");
  const submit = composerForm.locator('button.composer-submit:not(.stop)').first();
  await submit.waitFor({ state: "visible" });
  assert.match((await submit.innerText()).trim(), /发送|Send|排队|Queue/,
    "The visible composer action must explain whether the message sends now or queues.");
  assert.equal(await submit.isEnabled(), true, "The structured fixture composer action must be enabled.");
  await submit.click();
  await page.locator('.structured-message-parts[data-turn-status="completed"]').last().waitFor({ state: "visible" });
  await page.locator(".chat-markdown-image").last().waitFor({ state: "visible" });
  const completedTurn = page.locator('.structured-message-parts[data-turn-status="completed"]').last();
  const conversationTitlebar = page.locator(".conversation-titlebar");
  const statusRow = completedTurn.locator(".structured-run-status");
  const process = completedTurn.locator(".structured-process");
  const resultLayer = completedTurn.locator(".structured-result-layer");
  assert.equal(await conversationTitlebar.count(), 1, "An active conversation must have exactly one fixed title bar.");
  assert.equal(await statusRow.count(), 1, "The OAEP run status layer must render exactly once.");
  assert.equal(await process.count(), 1, "The OAEP process layer must render exactly once.");
  assert.equal(await resultLayer.count(), 1, "The OAEP result layer must render exactly once.");
  assert.equal(await process.locator("summary.structured-run-status").count(), 1, "Process disclosure must be the run status row, not a second row.");
  assert.equal(await statusRow.locator(".structured-process-label").count(), 1, "The merged status row must expose the process label.");
  assert.equal(await process.evaluate((node) => node.hasAttribute("open")), false, "A completed process must be collapsed by default.");
  assert.match(await resultLayer.innerText(), /Final answer|最终回答/, "The final answer must remain visible outside process details.");
  await process.locator("summary").click();
  assert.equal(await process.evaluate((node) => node.hasAttribute("open")), true, "The completed process must be expandable.");
  const processText = await process.innerText();
  assert.match(processText, /Analysis summary|分析摘要/, "Reasoning must be labeled as an analysis summary.");
  assert.match(processText, /Result ready/, "Completed progress commentary must remain available in history.");
  assert.match(processText, /Actions and changes|操作与变更/, "Tool and file activity must be available inside the process layer.");
  const processSummary = process.locator("summary");
  await processSummary.focus();
  await page.keyboard.press("Enter");
  assert.equal(await process.evaluate((node) => node.hasAttribute("open")), false,
    "The process disclosure must close from the keyboard.");
  await page.keyboard.press("Space");
  assert.equal(await process.evaluate((node) => node.hasAttribute("open")), true,
    "The process disclosure must open from the keyboard.");
  accessibility = await page.evaluate(() => {
    const scopes = [
      document.querySelector(".conversation-titlebar"),
      Array.from(document.querySelectorAll(".structured-message-parts")).at(-1),
      document.querySelector('[data-testid="composer-input"]')?.closest("form"),
    ].filter(Boolean);
    const elements = scopes.flatMap((scope) => Array.from(scope.querySelectorAll("button, input, textarea, select, summary, a[href]")))
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      });
    const accessibleName = (element) => String(
      element?.getAttribute("aria-label") || element?.getAttribute("title")
      || (element?.getAttribute("aria-labelledby")
        ? document.getElementById(element.getAttribute("aria-labelledby"))?.textContent : "")
      || element?.textContent || element?.getAttribute("placeholder") || element?.getAttribute("alt") || "",
    ).trim();
    const ids = Array.from(document.querySelectorAll("[id]")).map((element) => element.id).filter(Boolean);
    return {
      interactiveCount: elements.length,
      unnamedInteractive: elements.filter((element) => !accessibleName(element)).map((element) => element.outerHTML.slice(0, 160)),
      duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
      imagesMissingAlt: scopes.flatMap((scope) => Array.from(scope.querySelectorAll("img:not([alt])"))).length,
      composerName: accessibleName(document.querySelector('[data-testid="composer-input"]')),
      processSummaryName: accessibleName(Array.from(document.querySelectorAll("summary.structured-run-status")).at(-1)),
      keyboardDisclosureVerified: true,
    };
  });
  assert.equal(accessibility.unnamedInteractive.length, 0, `Interactive controls need accessible names: ${accessibility.unnamedInteractive.join(" | ")}`);
  assert.equal(accessibility.duplicateIds.length, 0, `Duplicate DOM ids: ${accessibility.duplicateIds.join(", ")}`);
  assert.equal(accessibility.imagesMissingAlt, 0, "Rendered conversation images must expose alternative text.");
  assert.ok(accessibility.composerName, "The composer must have an accessible name.");
  assert.ok(accessibility.processSummaryName, "The process disclosure must have an accessible name.");
  await page.addStyleTag({ content: `
    *, *::before, *::after { animation: none !important; transition: none !important; }
  ` });

  const scenarios = [
    { name: "desktop-100", width: 1440, height: 1000, zoom: 1 },
    { name: "desktop-125", width: 1440, height: 1000, zoom: 1.25 },
    { name: "desktop-150", width: 1440, height: 1000, zoom: 1.5 },
    { name: "narrow-100", width: 860, height: 900, zoom: 1 },
  ];

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.evaluate((zoom) => { document.documentElement.style.zoom = String(zoom); }, scenario.zoom);
    await page.waitForTimeout(180);
    const metrics = await page.evaluate(() => {
      const turn = Array.from(document.querySelectorAll(".structured-message-parts")).at(-1);
      const tableScroll = turn?.querySelector(".chat-table-scroll");
      const table = turn?.querySelector("table");
      const codeBlock = turn?.querySelector(".chat-code-block");
      const codePre = turn?.querySelector(".chat-code-block pre");
      const image = turn?.querySelector(".chat-markdown-image");
      const turnRect = turn?.getBoundingClientRect();
      const imageRect = image?.getBoundingClientRect();
      const status = turn?.querySelector(".structured-run-status");
      const statusRect = status?.getBoundingClientRect();
      const statusChildren = status ? Array.from(status.children).map((child) => child.getBoundingClientRect()) : [];
      const titlebarRect = document.querySelector(".conversation-titlebar")?.getBoundingClientRect();
      const messageListRect = document.querySelector(".message-list")?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        turnWidth: turnRect?.width || 0,
        tableColumns: table?.querySelectorAll("thead th").length || 0,
        tableClientWidth: tableScroll?.clientWidth || 0,
        tableScrollWidth: tableScroll?.scrollWidth || 0,
        tableWidth: table?.getBoundingClientRect().width || 0,
        tableScrollsInternally: Boolean(tableScroll && tableScroll.scrollWidth > tableScroll.clientWidth),
        tableFitsTurn: Boolean(tableScroll && turnRect && tableScroll.getBoundingClientRect().right <= turnRect.right + 1),
        codeScrollsInternally: Boolean(codePre && codePre.scrollWidth > codePre.clientWidth),
        codeFitsTurn: Boolean(codeBlock && turnRect && codeBlock.getBoundingClientRect().right <= turnRect.right + 1),
        imageLoaded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        imageFitsTurn: Boolean(imageRect && turnRect && imageRect.width <= turnRect.width + 1 && imageRect.right <= turnRect.right + 1),
        statusSingleLine: Boolean(statusRect && statusChildren.every((rect) => rect.top >= statusRect.top - 1 && rect.bottom <= statusRect.bottom + 1)),
        titlebarDoesNotOverlapMessages: Boolean(titlebarRect && messageListRect && messageListRect.top >= titlebarRect.bottom - 1),
      };
    });
    console.log(`${scenario.name}: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.documentWidth <= metrics.viewportWidth + 1, true, `${scenario.name}: document has horizontal overflow.`);
    assert.equal(metrics.tableColumns, 13, `${scenario.name}: wide table fixture was not rendered.`);
    assert.equal(metrics.tableScrollsInternally, true, `${scenario.name}: wide table must scroll inside its own container.`);
    assert.equal(metrics.tableFitsTurn, true, `${scenario.name}: table escaped the response column.`);
    assert.equal(metrics.codeScrollsInternally, true, `${scenario.name}: long code must scroll inside its own container.`);
    assert.equal(metrics.codeFitsTurn, true, `${scenario.name}: code block escaped the response column.`);
    assert.equal(metrics.imageLoaded, true, `${scenario.name}: fixture image did not load.`);
    assert.equal(metrics.imageFitsTurn, true, `${scenario.name}: image escaped the response column.`);
    assert.equal(metrics.statusSingleLine, true, `${scenario.name}: run status must remain on one line.`);
    assert.equal(metrics.titlebarDoesNotOverlapMessages, true, `${scenario.name}: conversation title bar overlaps the message list.`);

    const screenshotPath = join(evidenceDir, `${scenario.name}.png`);
    const screenshot = await page.screenshot({ path: screenshotPath, fullPage: false });
    assert.ok(screenshot.length > 20_000, `${scenario.name}: screenshot is unexpectedly blank or tiny.`);
    assert.equal(screenshot.readUInt32BE(16), scenario.width, `${scenario.name}: screenshot width mismatch.`);
    assert.equal(screenshot.readUInt32BE(20), scenario.height, `${scenario.name}: screenshot height mismatch.`);
    const contentScreenshots = {};
    for (const [kind, selector] of [
      ["table", ".chat-table-block"],
      ["code", ".chat-code-block"],
      ["image", ".chat-markdown-image"],
      ["process", ".structured-process"],
    ]) {
      const contentPath = join(evidenceDir, `${scenario.name}-${kind}.png`);
      await page.evaluate((targetSelector) => {
        const target = Array.from(document.querySelectorAll(targetSelector)).at(-1);
        target?.scrollIntoView({ block: "center", inline: "nearest" });
      }, selector);
      await page.waitForTimeout(80);
      const clip = await page.evaluate((targetSelector) => {
        const target = Array.from(document.querySelectorAll(targetSelector)).at(-1);
        const rect = target?.getBoundingClientRect();
        if (!rect) return null;
        return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
      }, selector);
      assert.ok(clip && clip.width > 0 && clip.height > 0, `${scenario.name}: ${kind} clip is unavailable.`);
      const contentScreenshot = await page.screenshot({ path: contentPath, clip });
      assert.ok(contentScreenshot.length > 8_000, `${scenario.name}: ${kind} screenshot is unexpectedly blank or tiny.`);
      contentScreenshots[`${kind}ScreenshotPath`] = contentPath;
      contentScreenshots[`${kind}ScreenshotBytes`] = contentScreenshot.length;
    }
    results.push({
      ...scenario,
      ...metrics,
      screenshotPath,
      screenshotBytes: screenshot.length,
      ...contentScreenshots,
    });
  }
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

const reportPath = join(evidenceDir, "report.json");
writeFileSync(reportPath, `${JSON.stringify({ ok: true, generatedAt: new Date().toISOString(), accessibility, results }, null, 2)}\n`);
console.log(`Structured visual verification passed (${results.length * 5} screenshots, OAEP four-layer layout and accessibility, report: ${reportPath}).`);
