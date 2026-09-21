import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
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
assert(existsSync(join(dist, "index.html")), "Build the production Renderer before running the Run Inspection safety verifier.");
assert(executablePath, "Chrome or Edge is required for the Run Inspection safety verifier.");

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
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1&runInspectionSafety=1`, { waitUntil: "networkidle" });
  const enter = page.getByTestId("developer-workspace-login");
  if (await enter.count()) await enter.click();
  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 10000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("opendrsai:open-run-inspection", { detail: {
    workspacePath: "C:\\Users\\Demo\\OpenDrSai\\workspace",
    workspaceId: "workspace-visual",
    runId: "mock-run-inspection-safety",
  } })));
  const inspector = page.locator('.run-inspector-panel[data-run-id="mock-run-inspection-safety"]');
  await inspector.waitFor({ state: "visible", timeout: 10000 });
  const initialText = await inspector.innerText();
  assert.match(initialText, /Compared the public evidence and verified the result/);

  const canaries = [
    "mock-raw-cot-canary", "mock-secret-key-canary", "mock-secret-token-canary",
    "mock-private-user", "mock-system-prompt-canary", "mock-input-body-canary",
  ];
  for (const canary of canaries) assert.equal(initialText.includes(canary), false, `collapsed Inspector leaked ${canary}`);

  await inspector.locator('[data-item-id="mock-safe-tool"]').click();
  await inspector.locator(".run-inspector-item-detail details summary").click();
  const technical = inspector.locator(".run-inspector-item-detail pre");
  await technical.waitFor({ state: "visible" });
  const technicalText = await technical.innerText();
  for (const canary of canaries) assert.equal(technicalText.includes(canary), false, `technical evidence leaked ${canary}`);
  assert.match(technicalText, /REDACTED/);

  const configuration = inspector.locator(".run-inspector-section").filter({ hasText: /Inputs and configuration|输入与配置/ });
  await configuration.locator("summary").click();
  const configurationText = await configuration.innerText();
  for (const canary of canaries) assert.equal(configurationText.includes(canary), false, `configuration evidence leaked ${canary}`);
  assert.match(configurationText, /REDACTED/);

  const evidenceDir = join(root, "release", "product-evidence", "run-inspection-safety");
  mkdirSync(evidenceDir, { recursive: true });
  await inspector.screenshot({ path: join(evidenceDir, "production-renderer-run-inspection-safety.png") });
  console.log(JSON.stringify({
    ok: true,
    publicReasoningSummaryVisible: true,
    rawChainOfThoughtMatches: 0,
    secretMatches: 0,
    privatePathMatches: 0,
    technicalEvidenceRedacted: true,
    configurationEvidenceRedacted: true,
  }, null, 2));
  await page.close();
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
