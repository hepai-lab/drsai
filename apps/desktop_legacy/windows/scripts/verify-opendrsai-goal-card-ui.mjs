import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
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
assert.ok(existsSync(join(dist, "index.html")) && executablePath, "Built renderer and Chrome/Edge are required.");
const mime = new Map([[".html", "text/html"], [".js", "text/javascript"], [".css", "text/css"], [".png", "image/png"], [".ttf", "font/ttf"]]);
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : normalize(pathname.replace(/^\/+/, ""));
  let path = resolve(dist, relative);
  if (!path.startsWith(resolve(dist)) || !existsSync(path) || statSync(path).isDirectory()) path = join(dist, "index.html");
  response.writeHead(200, { "Content-Type": mime.get(extname(path)) || "application/octet-stream" });
  response.end(readFileSync(path));
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address === "object");
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
try {
  await page.addInitScript(() => {
    window.localStorage.setItem("opendrsai:first-run-complete:v3", "true");
  });
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /进入开发者工作区|Enter developer workspace/ }).click();
  const composer = page.getByTestId("composer-input");
  await composer.waitFor({ state: "visible" });
  await page.getByTestId("composer-configuration-trigger").click();
  await page.getByTestId("composer-task-mode").click();
  await page.getByTestId("composer-task-mode-confirm_goal").click();
  await composer.fill("__GOAL_CONFIRMATION_FIXTURE__");
  const composerForm = composer.locator("xpath=ancestor::form[1]");
  const submit = composerForm.locator("button.composer-submit:not(.stop)").first();
  await submit.waitFor({ state: "visible" });
  assert.equal(await submit.isEnabled(), true, "Goal fixture composer action must be enabled.");
  await submit.click();
  const summary = page.locator('[data-testid="goal-confirmation-summary"]:visible');
  await summary.waitFor({ state: "visible" });
  assert.ok(!(await summary.innerText()).includes("Prepare a cited release briefing"), "Timeline must not duplicate the full Goal prompt.");
  const interaction = page.locator('[data-testid="composer-agent-interaction"]:visible');
  await interaction.waitFor({ state: "visible" });
  await interaction.getByText("Prepare a cited release briefing", { exact: true }).waitFor({ state: "visible" });
  assert.ok((await interaction.innerText()).includes("Prepare a cited release briefing"), "Composer omitted the Goal objective.");
  await interaction.locator("summary").click();
  const interactionText = await interaction.innerText();
  for (const expected of ["release-notes.md", "Two-page briefing", "Do not publish"]) {
    assert.ok(interactionText.includes(expected), `Composer Goal summary omitted ${expected}.`);
  }
  await interaction.getByTestId("composer-goal-edit").click();
  assert.equal(await interaction.getByTestId("composer-goal-objective").inputValue(), "Prepare a cited release briefing");
  assert.equal(await interaction.getByTestId("composer-goal-materials").inputValue(), "release-notes.md, metrics.csv");
  assert.equal(await interaction.getByTestId("composer-goal-outputs").inputValue(), "Two-page briefing");
  assert.equal(await interaction.getByTestId("composer-goal-constraints").inputValue(), "Do not publish; preserve source files");
  await interaction.getByTestId("composer-goal-objective").fill("Prepare a reviewed cited release briefing");
  await interaction.getByTestId("composer-goal-constraints").fill("Do not publish\nPreserve source files\nUse only supplied metrics");
  await interaction.getByTestId("composer-goal-save").click();
  await interaction.getByTestId("composer-goal-edit").waitFor({ state: "visible" });
  await interaction.getByTestId("composer-goal-confirm").click();
  await interaction.waitFor({ state: "hidden" });
  const routed = await page.evaluate(() => globalThis.__opendrsaiGoalFixtureResponses || []);
  assert.equal(routed.length, 2, "Edit and confirmation must each cross the production renderer bridge once.");
  assert.ok(routed.every((entry) => !String(entry.requestId).startsWith("goal:")), "Renderer sent OAEP Item identity instead of Chat turn identity.");
  assert.deepEqual(routed.map((entry) => entry.response?.decision), ["revise", "accept"]);
  assert.match(await summary.innerText(), /已处理|handled/i, "Timeline must retain only a compact handled state after confirmation.");
  const evidencePath = process.env.OPENDRSAI_GOAL_CARD_UI_EVIDENCE?.trim();
  if (evidencePath) {
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({
      schema_version: "opendrsai.windows.goal-confirmation-ui-evidence/1",
      captured_at: new Date().toISOString(),
      renderer: "production-build",
      fields_visible: ["objective", "materials", "outputs", "constraints"],
      interactions: { edit: true, supplement: true, confirm: true },
      bridge_calls: routed.length,
      bridge_decisions: routed.map((entry) => entry.response?.decision),
      chat_turn_identity_routing: routed.every((entry) => !String(entry.requestId).startsWith("goal:")),
      composer_hidden_after_response: true,
      timeline_prompt_compact: true,
      explicit_goal_confirmation_mode: true,
    }, null, 2)}\n`, "utf8");
  }
  console.log("OpenDrSai packaged renderer Goal composer UI passed (explicit mode, compact timeline, edit/supplement, confirm, turn identity routing)." );
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
