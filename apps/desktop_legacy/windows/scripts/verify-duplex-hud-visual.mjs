import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const chromeCandidates = [process.env.PLAYWRIGHT_CHROME_PATH, join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"), join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe")].filter(Boolean);
const executablePath = chromeCandidates.find(existsSync);
assert.ok(executablePath, "Chrome or Edge is required for HUD visual verification.");
const css = readFileSync(join(root, "../shared/renderer/src/styles.css"), "utf8");
const axe = readFileSync(join(root, "node_modules/axe-core/axe.min.js"), "utf8");
const evidenceDir = join(root, "out", "verification", "duplex-hud-p3"); mkdirSync(evidenceDir, { recursive: true });
const states = ["Connecting", "Listening", "You are speaking", "OpenDrSai is answering", "Recovering connection", "Microphone paused", "Ending", "Needs attention"];
const browser = await chromium.launch({ headless: true, executablePath });
const evidence = [];
try {
  for (const zoom of [1, 2]) for (const label of states) {
    const page = await browser.newPage({ viewport: { width: Math.floor(320 / zoom), height: Math.floor(420 / zoom) }, deviceScaleFactor: zoom });
    await page.setContent(`<style>${css}</style><main style="width:100%;padding:8px"><div class="composer-voice-status"><div class="duplex-hud-main"><strong role="status" aria-live="polite" aria-atomic="true">${label}</strong><label><span class="voice-sr-only">Input level</span><progress aria-label="Realtime voice input level" value=".45" max="1"></progress></label><div class="duplex-hud-actions"><button aria-pressed="false" aria-keyshortcuts="Alt+Shift+P">Pause</button><button aria-keyshortcuts="Alt+Shift+S">End conversation</button></div></div><details class="duplex-hud-details"><summary>Details</summary><div class="duplex-hud-details-panel"><small>Network buffer: 240 ms</small><small>Queued transcript</small><small>Tool awaiting approval</small><button>Cancel now</button></div></details></div></main><script>${axe}</script>`);
    const hud = page.locator(".composer-voice-status");
    const metrics = await hud.evaluate((node) => ({ right: node.getBoundingClientRect().right, width: node.scrollWidth, clientWidth: node.clientWidth, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
    assert.ok(metrics.right <= metrics.viewportWidth + 1 && metrics.documentWidth <= metrics.viewportWidth + 1 && metrics.width <= metrics.clientWidth + 1, `${label} overflowed at ${zoom * 100}%: ${JSON.stringify(metrics)}`);
    assert.equal(await hud.locator(".duplex-hud-actions button").count(), 2);
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    assert.equal(await hud.locator("details").getAttribute("open"), "");
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"))).violations.filter((item) => ["serious", "critical"].includes(item.impact)).map((item) => item.id));
    assert.deepEqual(violations, [], `${label} accessibility violations at ${zoom * 100}%`);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const screenshotPath = join(evidenceDir, `${slug}-${zoom * 100}.png`); await page.screenshot({ path: screenshotPath }); evidence.push({ label, zoom, metrics, screenshotPath });
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(join(evidenceDir, "report.json"), `${JSON.stringify({ ok: true, states, evidence }, null, 2)}\n`);
console.log(`Duplex HUD visual verification passed (${states.length} states at 100% and 200%, 320px, keyboard and axe).`);
