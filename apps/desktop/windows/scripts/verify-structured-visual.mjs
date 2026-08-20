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
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: [
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--metrics-recording-only",
    "--no-default-browser-check",
    "--no-first-run",
    "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.protocol === "data:" || url.protocol === "blob:") await route.continue();
  else await route.abort("blockedbyclient");
});
const results = [];
let accessibility = null;

try {
  await page.addInitScript(() => {
    window.localStorage.setItem("opendrsai:first-run-complete:v3", "true");
  });
  await page.goto(`${baseUrl}?structuredVisualFixture=1&conversationResourceFixture=1&conversationResourceNonInline=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /进入开发者工作区|Enter developer workspace/ }).click();
  const composer = page.getByTestId("composer-input");
  await composer.waitFor({ state: "visible" });
  const fixtureThread = page.getByText("P2 resource fixture", { exact: true }).first();
  if (await fixtureThread.isVisible().catch(() => false)) {
    await fixtureThread.click();
  }
  const p2ComposerChip = page.getByRole("button", { name: /打开资源: 引用资料\.md|Open resource: 引用资料\.md/ });
  await p2ComposerChip.waitFor({ state: "visible" });
  const orderedUserParts = p2ComposerChip.locator("xpath=ancestor::*[contains(@class,'message-ordered-draft-parts')][1]");
  assert.equal(await orderedUserParts.count(), 1, "The P2 input Chip must remain in the ordered Composer projection.");
  await p2ComposerChip.click({ button: "right" });
  const inputResourceMenu = page.getByTestId("conversation-resource-menu");
  await inputResourceMenu.waitFor({ state: "visible" });
  assert.equal(await inputResourceMenu.getByRole("menuitem", { name: /^预览$|^Preview$/ }).count(), 0,
    "A non-inline local Office file must not advertise Runtime preview.");
  assert.equal(await inputResourceMenu.getByRole("menuitem", { name: /在文件栏显示|Show in Files/ }).count(), 1);
  assert.equal(await inputResourceMenu.getByRole("menuitem", { name: /下载 \/ 另存为|Download \/ Save as/ }).count(), 1);
  assert.equal(await inputResourceMenu.getByRole("menuitem", { name: /在系统文件管理器中显示|Reveal in system file manager/ }).count(), 1,
    "A local P2 input file must expose the authorized reveal action.");
  await inputResourceMenu.getByRole("menuitem", { name: /在系统文件管理器中显示|Reveal in system file manager/ }).click();
  await page.getByTestId("conversation-resource-notice").waitFor({ state: "visible" });
  await p2ComposerChip.click();
  await page.locator('.files-context-preview').getByText("Mock extracted Office text preview.").waitFor({ state: "visible" });
  const deletedChip = page.getByRole("button", { name: /打开资源: 已删除资料\.md|Open resource: 已删除资料\.md/ });
  await deletedChip.click();
  assert.equal(await deletedChip.getAttribute("data-resource-state"), "deleted", "A deleted resource must report deleted in place.");
  assert.equal(await deletedChip.getAttribute("aria-disabled"), "true", "Deleted current-version open must be exposed as disabled to assistive technology.");
  const deletedNotice = page.getByTestId("conversation-resource-notice");
  assert.match(await deletedNotice.innerText(), /已删除|was deleted/);
  assert.doesNotMatch(await deletedNotice.innerText(), /离线|offline/i, "Deleted and offline must never share a user-facing state.");
  assert.equal(await deletedNotice.getByRole("button", { name: /打开引用时版本|Open cited version/ }).count(), 0,
    "A deleted resource without a retained snapshot must not advertise cited-version access.");
  await deletedChip.click({ button: "right", force: true });
  await inputResourceMenu.waitFor({ state: "visible" });
  assert.equal(await inputResourceMenu.getByRole("menuitem", { name: /在文件栏显示|Show in Files|打开当前版本|Open current version/ }).count(), 0,
    "A deleted resource must disable current-version open actions.");
  assert.equal(await inputResourceMenu.getByRole("menuitem", { name: /查看资源详情|Resource details/ }).count(), 1,
    "A deleted resource must retain its details action.");
  await page.keyboard.press("Escape");
  const offlineChip = page.getByRole("button", { name: /打开资源: 离线资料\.md|Open resource: 离线资料\.md/ });
  await offlineChip.click();
  assert.equal(await offlineChip.getAttribute("data-resource-state"), "offline", "An unreachable authority must report offline in place.");
  const offlineText = await page.getByTestId("conversation-resource-notice").innerText();
  assert.match(offlineText, /离线|offline/i);
  assert.doesNotMatch(offlineText, /已删除|was deleted/i, "Offline resources must not be described as deleted.");
  assert.equal(await page.getByTestId("conversation-resource-notice").getByRole("button", { name: /^重试$|^Retry$/ }).count(), 1);
  assert.equal(await page.getByTestId("conversation-resource-notice").getByRole("button", { name: /检查 \/ 切换 Runtime|Check \/ switch Runtime/ }).count(), 1);
  await offlineChip.click({ button: "right" });
  await inputResourceMenu.waitFor({ state: "visible" });
  assert.equal(await inputResourceMenu.getByRole("menuitem", { name: /^重试$|^Retry$/ }).count(), 1,
    "Offline resources must expose an explicit retry action.");
  await page.keyboard.press("Escape");
  const movedChip = page.getByRole("button", { name: /打开资源: 已移动资料|Open resource: 已移动资料/ });
  await movedChip.click();
  assert.equal(await movedChip.getAttribute("data-resource-state"), "moved", "A relocated resource must report moved in place.");
  assert.match(await page.getByTestId("conversation-resource-notice").innerText(), /已移动|moved/i);
  assert.equal(await movedChip.locator("bdi").count(), 1, "Untrusted Unicode/bidi resource labels must render in an isolation element.");
  await page.reload({ waitUntil: "networkidle" });
  const reloadBypass = page.getByRole("button", { name: /进入开发者工作区|Enter developer workspace/ });
  if (await reloadBypass.isVisible().catch(() => false)) await reloadBypass.click();
  await composer.waitFor({ state: "visible" });
  const reloadedThread = page.getByText("P2 resource fixture", { exact: true }).first();
  if (await reloadedThread.isVisible().catch(() => false)) await reloadedThread.click();
  await p2ComposerChip.waitFor({ state: "visible" });
  await p2ComposerChip.click();
  await page.locator('.files-context-preview').getByText("Mock extracted Office text preview.").waitFor({ state: "visible" });
  const bannerGeometry = await page.evaluate(() => {
    const panel = document.querySelector(".conversation-panel");
    const composerElement = document.querySelector(".composer");
    if (!panel || !composerElement) return null;
    const before = composerElement.getBoundingClientRect();
    const banner = document.createElement("div");
    banner.className = "conversation-history-error";
    banner.setAttribute("role", "alert");
    banner.innerHTML = "<span>OpenDrSai did not complete the operation. Retry if safe.</span><button type=\"button\">Retry</button>";
    panel.prepend(banner);
    const after = composerElement.getBoundingClientRect();
    const bannerRect = banner.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const position = getComputedStyle(banner).position;
    return {
      beforeTop: before.top,
      afterTop: after.top,
      position,
      contained: bannerRect.left >= panelRect.left && bannerRect.right <= panelRect.right,
    };
  });
  assert.ok(bannerGeometry, "The conversation panel and composer must be available for banner geometry verification.");
  assert.equal(bannerGeometry.position, "absolute", "A history failure banner must float above chat content.");
  assert.ok(Math.abs(bannerGeometry.beforeTop - bannerGeometry.afterTop) < 0.5, "A floating failure banner must not move the Composer.");
  assert.equal(bannerGeometry.contained, true, "The floating failure banner must stay within the conversation panel.");
  await page.screenshot({ path: join(evidenceDir, "floating-history-error.png"), fullPage: false });
  await page.evaluate(() => document.querySelector(".conversation-history-error")?.remove());
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
  const p2Artifact = completedTurn.getByRole("button", { name: /打开资源: README\.md|Open resource: README\.md/ });
  await p2Artifact.waitFor({ state: "visible" });
  assert.equal(await completedTurn.locator('.structured-artifact-card[data-artifact-id="mock-report"]').count(), 0, "An Artifact already named in the answer must render as one inline Markdown resource link, not a duplicate card.");
  assert.equal(await p2Artifact.getAttribute("data-artifact-inline-id") !== null, true, "The answer must carry the structured Artifact identity on its inline link.");
  assert.equal(await p2Artifact.getAttribute("data-resource-state"), null);
  await p2Artifact.click({ button: "right" });
  const resourceMenu = page.getByTestId("conversation-resource-menu");
  await resourceMenu.waitFor({ state: "visible" });
  assert.equal(await p2Artifact.getAttribute("data-resource-state"), "changed", "A version conflict must remain visible on the inline resource link itself.");
  for (const label of [/打开当前版本|Open current version/, /预览|Preview/, /打开引用时版本|Open cited version/, /下载 \/ 另存为|Download \/ Save as/, /复制逻辑路径|Copy logical path/, /查看资源详情|Resource details/]) {
    assert.equal(await resourceMenu.getByRole("menuitem", { name: label }).count(), 1, `Resource menu action ${label} must be capability-driven and visible.`);
  }
  await resourceMenu.getByRole("menuitem", { name: /下载 \/ 另存为|Download \/ Save as/ }).click();
  const resourceDownload = page.getByTestId("conversation-resource-download");
  await resourceDownload.waitFor({ state: "visible" });
  await resourceDownload.getByRole("button", { name: /取消下载|Cancel download/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="conversation-resource-download"]')?.getAttribute("data-phase") === "cancelled");
  assert.match(await resourceDownload.innerText(), /已取消|Cancelled/i, "A cancelled download must visibly return to a retryable state.");
  assert.equal(await resourceDownload.locator("progress").count(), 1, "Resource downloads must expose semantic progress.");
  await page.keyboard.press("Escape");
  await resourceMenu.waitFor({ state: "hidden" });
  await p2Artifact.focus();
  await page.keyboard.press("Shift+F10");
  await resourceMenu.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitem");
  assert.match(await page.evaluate(() => document.activeElement?.textContent || ""), /打开当前版本|Open current version/,
    "The capability menu must move focus to its first available action.");
  await page.keyboard.press("End");
  assert.match(await page.evaluate(() => document.activeElement?.textContent || ""), /查看资源详情|Resource details/,
    "End must move to the last resource action.");
  await page.keyboard.press("Escape");
  assert.equal(await p2Artifact.evaluate((element) => element === document.activeElement), true,
    "Closing a keyboard-opened resource menu must restore focus to its trigger.");
  await page.keyboard.press("Shift+F10");
  await resourceMenu.waitFor({ state: "visible" });
  await resourceMenu.getByRole("menuitem", { name: /查看资源详情|Resource details/ }).click();
  await page.getByTestId("conversation-resource-notice").waitFor({ state: "visible" });
  await p2Artifact.click({ button: "right" });
  await resourceMenu.getByRole("menuitem", { name: /打开引用时版本|Open cited version/ }).click();
  await page.locator('.files-context-preview').getByText("Mock cited-version preview.").waitFor({ state: "visible" });
  await p2Artifact.click();
  const resourceNotice = page.getByTestId("conversation-resource-notice");
  await resourceNotice.waitFor({ state: "visible" });
  assert.match(await resourceNotice.innerText(), /已变化|changed/i);
  assert.equal(await resourceNotice.getByRole("button", { name: /打开引用时版本|Open cited version/ }).count(), 1,
    "A changed resource must offer the retained cited version next to the current-version result.");
  const resourcePreview = page.locator('.files-context-preview').getByText("Mock Runtime artifact preview.");
  await resourcePreview.waitFor({ state: "visible" });
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
  assert.match(await resultLayer.innerText(), /Answer|回答/, "The answer must remain visible outside process details.");
  await process.locator("summary").click();
  assert.equal(await process.evaluate((node) => node.hasAttribute("open")), true, "The completed process must be expandable.");
  await process.locator(".structured-process-content").waitFor({ state: "visible" });
  const processText = await process.innerText();
  assert.match(processText, /Analysis notes|分析说明/, "Reasoning must be represented by a concise expandable analysis disclosure.");
  assert.match(processText, /Result ready/, "Completed progress commentary must remain available in history.");
  assert.match(processText, /Actions and files|操作与文件/, "Grouped tool and file activity must be available inside the process layer.");
  const analysis = process.locator(".structured-analysis-disclosure");
  assert.equal(await analysis.evaluate((node) => node.hasAttribute("open")), false, "Raw analysis details must remain collapsed by default.");
  await analysis.locator("summary").click();
  assert.equal(await analysis.evaluate((node) => node.hasAttribute("open")), true, "Analysis evidence must remain expandable.");
  const processSummary = process.locator("summary.structured-run-status");
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
