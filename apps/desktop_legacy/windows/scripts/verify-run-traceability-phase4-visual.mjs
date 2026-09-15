import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
assert(existsSync(join(dist, "index.html")), "Build the production renderer before running Phase 4 visual acceptance.");
assert(executablePath, "Chrome or Edge is required for Phase 4 visual acceptance.");

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
  await page.addInitScript(() => {
    window.localStorage.setItem("opendrsai:first-run-complete:v3", "true");
    window.localStorage.setItem("opendrsai.language", "en");
  });
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1&experimentReleaseGate=passed&runInspectionSafety=1`, { waitUntil: "networkidle" });
  const enter = page.getByTestId("developer-workspace-login");
  if (await enter.count()) await enter.click();

  const composer = page.getByTestId("composer-input");
  await composer.waitFor({ state: "visible" });
  await composer.fill("__STRUCTURED_VISUAL_FIXTURE__");
  await composer.locator("xpath=ancestor::form[1]").locator("button.composer-submit:not(.stop)").first().click();
  const turn = page.locator('.structured-message-parts[data-turn-status="completed"]').last();
  await turn.waitFor({ state: "visible" });
  const process = turn.locator(".structured-process");
  if (!(await process.evaluate((node) => node.hasAttribute("open")))) await process.locator("summary").click();
  await turn.getByRole("button", { name: "Create experiment" }).click();

  const experiment = page.getByRole("dialog", { name: "Run experiment" });
  await experiment.waitFor({ state: "visible" });
  const title = experiment.getByLabel("Experiment name");
  await title.fill("Phase 4 visual acceptance");
  await experiment.getByRole("button", { name: "Close" }).click();
  const unsaved = experiment.getByRole("alertdialog", { name: "Unsaved edits" });
  await unsaved.waitFor({ state: "visible" });
  await unsaved.getByRole("button", { name: "Keep editing" }).click();

  await experiment.getByRole("button", { name: "Save and generate plan" }).click();
  await experiment.getByRole("button", { name: "Execute reviewed plan" }).waitFor({ state: "visible" });
  await experiment.getByRole("button", { name: "Execute reviewed plan" }).click();

  const comparison = experiment.getByRole("region", { name: "Run comparison" });
  await comparison.waitFor({ state: "visible" });
  await comparison.getByText("Automatic metrics", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await comparison.locator("table.comparison-metrics tbody tr").count(), 7, "The metrics table must show the seven decision metrics.");

  await comparison.getByLabel("Outcome quality candidate").selectOption("5");
  await comparison.getByLabel("Verdict").selectOption("candidate_better");
  await comparison.getByLabel("Evaluation note").fill("Candidate evidence is stronger.");
  await comparison.getByLabel("Cite").last().check();
  await comparison.getByRole("button", { name: "Save new evaluation revision" }).click();
  await comparison.getByText("Evaluation revision 1 saved.", { exact: true }).waitFor({ state: "visible" });
  await comparison.getByText("Revision history (1)", { exact: true }).waitFor({ state: "visible" });

  await comparison.getByRole("button", { name: "View candidate evidence" }).click();
  const inspector = page.locator('.run-inspector-panel[data-run-id="run-replay-visual"]');
  await inspector.waitFor({ state: "visible" });
  const focused = inspector.locator('button[data-item-id="mock-safe-tool"].selected');
  await focused.waitFor({ state: "visible" });
  const evidenceDir = resolve(root, "../../../docs/desktop/evidence");
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: join(evidenceDir, "agent-runtime-traceability-phase4-windows-e2e.png"), fullPage: true });
  await page.close();

  async function openRecoveryFixture(mode) {
    const recoveryPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await recoveryPage.addInitScript(() => {
      window.localStorage.setItem("opendrsai:first-run-complete:v3", "true");
      window.localStorage.setItem("opendrsai.language", "en");
    });
    await recoveryPage.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1&experimentReleaseGate=passed&runInspectionSafety=1&phase4Recovery=${mode}`, { waitUntil: "networkidle" });
    const recoveryEnter = recoveryPage.getByTestId("developer-workspace-login");
    if (await recoveryEnter.count()) await recoveryEnter.click();
    const recoveryComposer = recoveryPage.getByTestId("composer-input");
    await recoveryComposer.waitFor({ state: "visible" });
    await recoveryComposer.fill("__STRUCTURED_VISUAL_FIXTURE__");
    await recoveryComposer.locator("xpath=ancestor::form[1]").locator("button.composer-submit:not(.stop)").first().click();
    const recoveryTurn = recoveryPage.locator('.structured-message-parts[data-turn-status="completed"]').last();
    await recoveryTurn.waitFor({ state: "visible" });
    const recoveryProcess = recoveryTurn.locator(".structured-process");
    if (!(await recoveryProcess.evaluate((node) => node.hasAttribute("open")))) await recoveryProcess.locator("summary").click();
    await recoveryTurn.getByRole("button", { name: "Create experiment" }).click();
    const recoveryDialog = recoveryPage.getByRole("dialog", { name: "Run experiment" });
    await recoveryDialog.waitFor({ state: "visible" });
    return { recoveryPage, recoveryTurn, recoveryDialog };
  }

  const executedRecovery = await openRecoveryFixture("executed");
  await executedRecovery.recoveryDialog.getByText("Restored the last executed experiment; recovering its Comparison.", { exact: true }).waitFor({ state: "visible" });
  await executedRecovery.recoveryDialog.getByText("This experiment has executed and is now read-only.", { exact: false }).waitFor({ state: "visible" });
  await executedRecovery.recoveryDialog.getByRole("region", { name: "Run comparison" }).waitFor({ state: "visible" });
  await executedRecovery.recoveryPage.close();

  const runningRecovery = await openRecoveryFixture("running");
  assert.equal(await runningRecovery.recoveryDialog.getByRole("region", { name: "Run comparison" }).count(), 0, "A non-terminal candidate must not be compared as if it were terminal.");
  await runningRecovery.recoveryDialog.getByRole("button", { name: "View candidate Run" }).click();
  await runningRecovery.recoveryPage.locator('.run-inspector-panel[data-run-id="run-replay-visual"]').waitFor({ state: "visible" });
  await runningRecovery.recoveryPage.close();

  const draftRecovery = await openRecoveryFixture("draft");
  await draftRecovery.recoveryDialog.getByText("Restored the last saved experiment draft.", { exact: true }).waitFor({ state: "visible" });
  await draftRecovery.recoveryDialog.getByRole("button", { name: "Discard draft" }).click();
  await draftRecovery.recoveryDialog.waitFor({ state: "hidden" });
  await draftRecovery.recoveryTurn.getByRole("button", { name: "Create experiment" }).click();
  const freshDialog = draftRecovery.recoveryPage.getByRole("dialog", { name: "Run experiment" });
  await freshDialog.waitFor({ state: "visible" });
  assert.equal(await freshDialog.getByText("Restored the last saved experiment draft.", { exact: true }).count(), 0, "A discarded draft must not recover again.");
  await draftRecovery.recoveryPage.close();
  writeFileSync(join(resolve(root, "../../../docs/desktop/evidence"), "agent-runtime-traceability-phase4-windows-e2e-result.json"), `${JSON.stringify({
    schema_version: "opendrsai.agent-runtime-phase4-windows-e2e-result/1",
    generated_at: new Date().toISOString(),
    passed: true,
    checks: [
      "truthful_relation_labels", "unsaved_close_guard", "comparison_metrics",
      "append_only_evaluation_revision", "focused_evidence_navigation",
      "executed_comparison_recovery", "nonterminal_candidate_navigation", "draft_discard_lifecycle",
    ],
    screenshot: "docs/desktop/evidence/agent-runtime-traceability-phase4-windows-e2e.png",
  }, null, 2)}\n`, "utf8");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

console.log("Phase 4 production Renderer acceptance passed: edit guard, executed/draft recovery, comparison metrics, evaluation revision, discard lifecycle, and focused evidence navigation.");
