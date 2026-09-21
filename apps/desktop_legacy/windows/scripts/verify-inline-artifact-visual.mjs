import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const distDir = join(root, "out", "renderer");
const evidenceDir = join(root, "out", "verification", "inline-artifact-link");
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium-1223", "chrome-win64", "chrome.exe"),
  join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);
const chromePath = browserCandidates.find((candidate) => existsSync(candidate));
assert.ok(existsSync(join(distDir, "index.html")), "Build the renderer before running inline Artifact visual verification.");
assert.ok(chromePath, "Chromium, Chrome or Edge is required for inline Artifact visual verification.");
mkdirSync(evidenceDir, { recursive: true });

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".png", "image/png"], [".svg", "image/svg+xml"], [".woff2", "font/woff2"], [".ttf", "font/ttf"],
]);
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  const relativePath = pathname === "/" ? "index.html" : normalize(pathname.replace(/^\/+/, ""));
  let filePath = resolve(distDir, relativePath);
  if (!filePath.startsWith(resolve(distDir)) || !existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(distDir, "index.html");
  response.writeHead(200, { "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream" });
  response.end(readFileSync(filePath));
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address === "object");
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--disable-background-networking", "--disable-component-update", "--disable-domain-reliability", "--metrics-recording-only", "--no-default-browser-check", "--no-first-run"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["127.0.0.1", "localhost"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol)) await route.continue();
  else await route.abort("blockedbyclient");
});

try {
  await page.addInitScript(() => window.localStorage.setItem("opendrsai:first-run-complete:v3", "true"));
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1`, { waitUntil: "networkidle" });
  const enter = page.getByTestId("developer-workspace-login");
  if (await enter.count()) await enter.click();
  const composer = page.getByTestId("composer-input");
  await composer.waitFor({ state: "visible" });
  await composer.fill("__STRUCTURED_VISUAL_FIXTURE__");
  await composer.locator("xpath=ancestor::form[1]").locator("button.composer-submit:not(.stop)").first().click();
  const turn = page.locator('.structured-message-parts[data-turn-status="completed"]').last();
  await turn.waitFor({ state: "visible" });
  const link = turn.getByRole("button", { name: /打开资源: README\.md|Open resource: README\.md/ });
  await link.waitFor({ state: "visible" });
  assert.equal(await link.getAttribute("data-artifact-inline-id") !== null, true, "Inline link must retain the structured Artifact identity.");
  assert.equal(await turn.locator('.structured-artifact-card[data-artifact-id="mock-report"]').count(), 0, "A named Artifact must not render a duplicate card below the answer.");
  await link.click();
  await page.locator(".files-context-preview").getByText("Mock Runtime artifact preview.").waitFor({ state: "visible" });
  assert.equal(await page.getByText(/成果文件已移动、删除或暂时不可用|artifact was moved, deleted, or is temporarily unavailable/).count(), 0,
    "A valid remote preview must not be reported as missing from the local workspace tree.");
  await link.click({ button: "right" });
  const menu = page.getByTestId("conversation-resource-menu");
  await menu.waitFor({ state: "visible" });
  assert.equal(await link.getAttribute("data-resource-state"), "changed", "The inline link must retain live resource state.");
  assert.equal(await menu.getByRole("menuitem", { name: /打开引用时版本|Open cited version/ }).count(), 1, "Inline link must retain the cited-version action menu.");
  await page.keyboard.press("Escape");
  await link.focus();
  await page.keyboard.press("Shift+F10");
  await menu.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  assert.equal(await link.evaluate((element) => element === document.activeElement), true, "Closing the inline resource menu must restore focus to the link.");
  await turn.screenshot({ path: join(evidenceDir, "inline-artifact-link.png") });

  await composer.fill("A reply that does not name its generated file.");
  await composer.locator("xpath=ancestor::form[1]").locator("button.composer-submit:not(.stop)").first().click();
  const fallbackTurn = page.locator('.structured-message-parts[data-turn-status="completed"]').last();
  await fallbackTurn.waitFor({ state: "visible" });
  await fallbackTurn.locator('.structured-artifact-card[data-artifact-id="mock-report"]').waitFor({ state: "visible" });
  assert.equal(await fallbackTurn.locator('[data-artifact-inline-id]').count(), 0, "An unmentioned Artifact must remain discoverable through its fallback card.");
  console.log("Inline Artifact visual verification passed (blue answer link, Files preview, menu/a11y, no duplicate card, fallback card). ");
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
