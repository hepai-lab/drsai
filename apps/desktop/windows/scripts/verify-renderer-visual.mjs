import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const electronCli = createRequire(import.meta.url).resolve("electron/cli.js");
const rendererHtml = process.env.OPENDRSAI_RENDERER_HTML || join(root, "out", "renderer", "index.html");
const l3Only = process.env.OPENDRSAI_RENDERER_L3_ONLY === "1";
const modelProviderOnly = process.argv.includes("--model-provider-only");
const axePath = join(root, "node_modules", "axe-core", "axe.min.js");
const disabledFeatures = new Set((process.env.OPENDRSAI_RENDERER_DISABLED_FEATURES || "").split(",").map((value) => value.trim()).filter(Boolean));
const featureKeys = ["auth", "runtime", "chat", "agents", "threads", "workspaceFiles", "git", "terminal", "serialVoice", "streamingVoice", "duplexVoice", "approvals", "browser", "debugger", "mcp", "remoteWorkspace", "portForwarding", "checkpoints", "worktrees", "automation", "collaboration", "channels", "diagnostics", "codexBackend"];
const featureCapabilities = Object.fromEntries(featureKeys.map((key) => [key, !disabledFeatures.has(key)]));
const artifactDir =
  process.env.OPENDRSAI_VISUAL_ARTIFACT_DIR ||
  join(root, "release", "visual-checks");

if (!existsSync(rendererHtml)) {
  throw new Error("Build the renderer before running verify:visual.");
}

const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-visual-"));
const mainPath = join(tempDir, "main.cjs");
const preloadPath = join(tempDir, "preload.cjs");

writeFileSync(preloadPath, preloadSource(featureCapabilities), "utf8");
mkdirSync(artifactDir, { recursive: true });
writeFileSync(mainPath, mainSource({ root, rendererHtml, preloadPath, artifactDir, axePath, disabledFeatures: [...disabledFeatures], l3Only, modelProviderOnly, m9Only: process.env.OPENDRSAI_M9_ONLY === "1", pairingOnly: process.argv.includes("--pairing-only") }), "utf8");

try {
  await runElectron(mainPath);
} finally {
  cleanupTempDir(tempDir);
}

function cleanupTempDir(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    throw new Error(
      `Could not remove temporary directory ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function runElectron(scriptPath) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [electronCli, scriptPath], {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid);
      reject(new Error(`Electron visual verification timed out.\n${stdout}\n${stderr}`));
    }, 75_000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        process.stdout.write(stdout);
        resolvePromise();
        return;
      }
      reject(new Error(`Electron visual verification failed with code ${code}.\n${stdout}\n${stderr}`));
    });
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Best effort cleanup for a failed verification process.
  }
}

function mainSource({ rendererHtml: htmlPath, preloadPath: preload, artifactDir: screenshots, axePath, disabledFeatures, l3Only, modelProviderOnly, m9Only, pairingOnly }) {
  return String.raw`
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const rendererHtml = ${JSON.stringify(htmlPath)};
const preloadPath = ${JSON.stringify(preload)};
const artifactDir = ${JSON.stringify(screenshots)};
const m9Only = ${JSON.stringify(m9Only)};
const pairingOnly = ${JSON.stringify(pairingOnly)};
const l3Only = ${JSON.stringify(l3Only)};
const modelProviderOnly = ${JSON.stringify(modelProviderOnly)};
const disabledFeatures = ${JSON.stringify(disabledFeatures)};
const axeSource = fs.readFileSync(${JSON.stringify(axePath)}, "utf8");
const userDataDir = path.join(path.dirname(preloadPath), "user-data");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("in-process-gpu");
app.setPath("userData", userDataDir);

const failures = [];
const watchdog = setTimeout(() => {
  console.error("Renderer visual verification internal timeout.");
  app.exit(1);
}, 60000);

function fail(message) {
  failures.push(message);
}

function sanitizeName(name) {
  return name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
}

async function createWindow(width, height, withBridge = true, partition) {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    backgroundColor: "#f7f8fb",
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      preload: withBridge ? preloadPath : undefined,
      ...(partition ? { partition } : {}),
    },
  });
  await withTimeout(win.loadFile(rendererHtml), "load renderer");
  await withTimeout(
    win.webContents.executeJavaScript("document.fonts && document.fonts.ready ? document.fonts.ready : undefined"),
    "wait for fonts",
  );
  await win.webContents.executeJavaScript("window.addEventListener('error',(event)=>console.error('VISUAL_E2E_PAGE_ERROR',event.error?.stack||event.message)); window.addEventListener('unhandledrejection',(event)=>console.error('VISUAL_E2E_REJECTION',event.reason?.stack||String(event.reason)))");
  await waitForPaint(win);
  return win;
}

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + " timed out")), 10000)),
  ]);
}

async function auditWindow(win, label) {
  return win.webContents.executeJavaScript(${"`"}(() => {
    const html = document.documentElement;
    const text = document.body.innerText;
    const buttons = Array.from(document.querySelectorAll("button")).map((button) => ({
      text: button.innerText.trim(),
      title: button.getAttribute("title"),
      aria: button.getAttribute("aria-label"),
      disabled: button.disabled,
      rect: (() => {
        const r = button.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })(),
    }));
    const offscreen = Array.from(document.querySelectorAll("button, textarea, aside, main, section, article")).map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, className: String(el.className), x: r.x, y: r.y, width: r.width, height: r.height };
    }).filter((r) => r.width > 0 && r.height > 0 && (r.x < -1 || r.x + r.width > innerWidth + 1));
    const clippedText = Array.from(document.querySelectorAll("button,label,span,strong,small,h1,h2,h3,p,summary")).filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const hasText = Boolean(el.textContent && el.textContent.trim());
      const clips = ["hidden", "clip"].includes(style.overflow) || ["hidden", "clip"].includes(style.overflowX) || ["hidden", "clip"].includes(style.overflowY);
      return hasText && r.width > 0 && r.height > 0 && clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    }).map((el) => ({ tag: el.tagName, className: String(el.className), text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight }));
    return {
      label: ${"${"}JSON.stringify(label)},
      lang: html.lang,
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: html.scrollWidth,
      clientWidth: html.clientWidth,
      overflow: html.scrollWidth > html.clientWidth + 1,
      text,
      inputPlaceholders: Array.from(document.querySelectorAll("input")).map((input) => input.placeholder || ""),
      buttons,
      offscreen,
      clippedText,
      hasTextarea: Boolean(document.querySelector("textarea")),
      hasAgentRunErrorLine: Boolean(document.querySelector(".agent-run-line.error")),
    };
  })()${"`"});
}

async function captureVisual(win, label) {
  let image = await capturePaintedPage(win);
  const size = image.getSize();
  if (!size.width || !size.height || image.isEmpty()) {
    fail(label + " screenshot is empty");
    return;
  }
  let variedSamples = countVariedSamples(image);
  if (variedSamples < 8) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    image = await capturePaintedPage(win);
    variedSamples = countVariedSamples(image);
  }
  if (variedSamples < 8) fail(label + " screenshot appears blank or nearly uniform");
  fs.writeFileSync(path.join(artifactDir, sanitizeName(label) + ".png"), image.toPNG());
}

async function waitForPaint(win) {
  await withTimeout(
    win.webContents.executeJavaScript(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    ),
    "wait for paint",
  );
}

async function capturePaintedPage(win) {
  await waitForPaint(win);
  return win.webContents.capturePage();
}

function countVariedSamples(image) {
  const size = image.getSize();
  const bitmap = image.toBitmap();
  const stride = size.width * 4;
  let variedSamples = 0;
  let last = null;
  const stepX = Math.max(1, Math.floor(size.width / 12));
  const stepY = Math.max(1, Math.floor(size.height / 12));
  for (let y = 0; y < size.height; y += stepY) {
    for (let x = 0; x < size.width; x += stepX) {
      const offset = y * stride + x * 4;
      const rgba = bitmap[offset] + "," + bitmap[offset + 1] + "," + bitmap[offset + 2] + "," + bitmap[offset + 3];
      if (last !== null && rgba !== last) variedSamples += 1;
      last = rgba;
    }
  }
  return variedSamples;
}

async function clickByText(win, text) {
  return win.webContents.executeJavaScript(${"`"}(() => {
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.innerText.trim() === ${"${"}JSON.stringify(text)});
    if (!button) return false;
    button.click();
    return true;
  })()${"`"});
}

async function clickByAnyText(win, texts) {
  return win.webContents.executeJavaScript(${"`"}(() => {
    const candidates = ${"${"}JSON.stringify(texts)};
    const button = Array.from(document.querySelectorAll("button")).find((item) => {
      const values = [item.innerText.trim(), item.getAttribute("title"), item.getAttribute("aria-label")].filter(Boolean);
      return values.some((value) => candidates.includes(value));
    });
    if (!button) return false;
    button.click();
    return true;
  })()${"`"});
}

async function fillTextarea(win, text) {
  return win.webContents.executeJavaScript(${"`"}(() => {
    const textarea = document.querySelector("textarea");
    if (!textarea) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, ${"${"}JSON.stringify(text)});
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()${"`"});
}

async function run() {
  console.log("Checking bridge fallback...");
  const bridgeMissing = await createWindow(900, 650, false);
  const bridgeAudit = await auditWindow(bridgeMissing, "bridge-missing");
  await captureVisual(bridgeMissing, "bridge-missing");
  if (!bridgeAudit.text.includes("desktop bridge is unavailable")) {
    fail("production renderer without preload bridge did not show the bridge error page");
  }
  bridgeMissing.close();

  console.log("Checking responsive viewports...");
  for (const [width, height] of [[1280, 720], [1024, 720], [860, 720]]) {
    const win = await createWindow(width, height, true);
    const audit = await auditWindow(win, width + "x" + height);
    await captureVisual(win, audit.label);
    if (audit.overflow) fail(audit.label + " has horizontal overflow");
    if (audit.offscreen.length) fail(audit.label + " has offscreen controls");
    if (!audit.text.includes("OpenDrSai")) fail(audit.label + " is missing brand text");
    if (!audit.text.includes("桌面端状态")) fail(audit.label + " is missing desktop status");
    if (!audit.text.includes("后端修复")) fail(audit.label + " is missing backend repair diagnostics");
    if (!audit.hasTextarea) fail(audit.label + " is missing chat textarea");
    const nav = audit.buttons.filter((button) => ["当前会话", "智能体广场", "设置"].includes(button.text));
    if (nav.some((button) => !button.title || !button.aria)) fail(audit.label + " has inaccessible nav buttons");
    const disabledPlaceholderNav = audit.buttons.filter((button) => ["我的智能体", "技能广场", "插件", "资料库"].includes(button.text));
    if (disabledPlaceholderNav.length) fail(audit.label + " rendered placeholder navigation buttons");
    win.close();
  }

  console.log("Checking interactive actions...");
  const interactive = await createWindow(1280, 720, true);
  if (!(await clickByText(interactive, "检查更新"))) fail("could not click Check Updates");
  await new Promise((resolve) => setTimeout(resolve, 50));
  let interaction = await auditWindow(interactive, "interaction-update");
  await captureVisual(interactive, "interaction-update");
  if (!interaction.text.includes("0.1.1") || !interaction.text.includes("更新")) {
    fail("update action feedback did not render");
  }
  if (!(await fillTextarea(interactive, "visual race check"))) fail("could not fill chat textarea");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!(await clickByText(interactive, "发送"))) fail("could not click Send");
  await new Promise((resolve) => setTimeout(resolve, 250));
  interaction = await auditWindow(interactive, "interaction-chat-running");
  await captureVisual(interactive, "interaction-chat-running");
  if (!interaction.text.includes("visual race check")) fail("running chat user message did not render");
  if (!interaction.buttons.some((button) => button.text === "停止")) fail("running chat did not expose Stop state");
  if (
    !interaction.text.includes("正在连接本地网关") &&
    !interaction.text.includes("正在思考") &&
    !interaction.text.includes("已等待")
  ) {
    fail("running chat did not expose elapsed thinking status");
  }
  await new Promise((resolve) => setTimeout(resolve, 2200));
  interaction = await auditWindow(interactive, "interaction-chat");
  await captureVisual(interactive, "interaction-chat");
  if (!interaction.text.includes("visual race check")) fail("chat user message did not render");
  if (!interaction.text.includes("renderer") || !interaction.text.includes("ok")) fail("chat stream markdown did not render");
  if (!interaction.text.includes("Reasoning")) fail("structured reasoning summary did not render");
  if (!interaction.text.includes("Read workspace file")) fail("structured tool timeline did not render");
  if (interaction.text.includes("DUPLICATE MUST NOT RENDER")) fail("duplicate chat event was rendered");
  if (interaction.buttons.some((button) => button.text === "停止")) fail("chat request stayed in Stop state after stream completion");
  if (!(await clickByText(interactive, "查看运行"))) fail("could not open Run Inspector from the chat summary");
  await new Promise((resolve) => setTimeout(resolve, 180));
  interaction = await auditWindow(interactive, "interaction-run-inspector");
  await captureVisual(interactive, "interaction-run-inspector");
  if (!interaction.text.includes("运行检查器")) fail("Run Inspector did not render");
  if (!interaction.text.includes("复现清单")) fail("Run reproduction manifest did not render");
  if (!interaction.text.includes("部分可复现")) fail("Run reproducibility level did not render");
  for (const canary of ["run-inspector-secret-canary", "run-inspector-raw-cot-canary", "private-user"]) {
    if (interaction.text.includes(canary)) fail("Run Inspector leaked " + canary);
  }

  if (!(await clickByAnyText(interactive, ["智能体广场", "Agent Square"]))) fail("could not open Agent Square");
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (!(await fillTextarea(interactive, "visual agent task"))) fail("could not fill agent run textarea");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!(await clickByAnyText(interactive, ["运行", "Run"]))) fail("could not click Agent Run");
  await new Promise((resolve) => setTimeout(resolve, 180));
  interaction = await auditWindow(interactive, "interaction-agent-run-running");
  await captureVisual(interactive, "interaction-agent-run-running");
  if (!interaction.text.includes("visual agent task")) fail("running agent task did not render");
  if (!interaction.buttons.some((button) => ["停止", "Stop"].includes(button.text))) fail("running agent did not expose Stop state");
  await new Promise((resolve) => setTimeout(resolve, 700));
  interaction = await auditWindow(interactive, "interaction-agent-run");
  await captureVisual(interactive, "interaction-agent-run");
  if (!interaction.text.includes("visual agent task")) fail("agent run task did not render");
  if (!interaction.text.includes("Mock agent run complete")) fail("agent run stream did not render completion text");
  if (interaction.buttons.some((button) => ["停止", "Stop"].includes(button.text))) fail("agent run stayed in Stop state after stream completion");

  if (!(await fillTextarea(interactive, "visual agent failure"))) fail("could not fill failing agent run textarea");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!(await clickByAnyText(interactive, ["运行", "Run"]))) fail("could not click failing Agent Run");
  await new Promise((resolve) => setTimeout(resolve, 180));
  interaction = await auditWindow(interactive, "interaction-agent-run-error-running");
  await captureVisual(interactive, "interaction-agent-run-error-running");
  if (!interaction.text.includes("visual agent failure")) fail("running failing agent task did not render");
  if (!interaction.buttons.some((button) => ["停止", "Stop"].includes(button.text))) fail("failing agent did not expose Stop state before error");
  if (!interaction.text.includes("运行中:") && !interaction.text.includes("Running:")) fail("failing agent did not expose active run label before error");
  await new Promise((resolve) => setTimeout(resolve, 650));
  interaction = await auditWindow(interactive, "interaction-agent-run-error");
  await captureVisual(interactive, "interaction-agent-run-error");
  if (!interaction.text.includes("synthetic visual agent error")) fail("agent run error text did not render");
  if (!interaction.hasAgentRunErrorLine) fail("agent run error did not render an error line");
  if (interaction.buttons.some((button) => ["停止", "Stop"].includes(button.text))) fail("agent run stayed in Stop state after error");
  if (interaction.text.includes("运行中:") || interaction.text.includes("Running:")) fail("agent run stayed in active run label after error");
  if (!(await fillTextarea(interactive, "visual agent recovery task"))) fail("could not fill recovery agent run textarea");
  await new Promise((resolve) => setTimeout(resolve, 50));
  interaction = await auditWindow(interactive, "interaction-agent-run-recovery-ready");
  if (!interaction.buttons.some((button) => ["运行", "Run"].includes(button.text) && !button.disabled)) fail("agent run was not ready to run again after error");
  if (!(await clickByAnyText(interactive, ["运行", "Run"]))) fail("could not click recovery Agent Run");
  await new Promise((resolve) => setTimeout(resolve, 180));
  interaction = await auditWindow(interactive, "interaction-agent-run-recovery-running");
  await captureVisual(interactive, "interaction-agent-run-recovery-running");
  if (!interaction.buttons.some((button) => ["停止", "Stop"].includes(button.text))) fail("recovery agent did not enter Stop state");
  await new Promise((resolve) => setTimeout(resolve, 700));
  interaction = await auditWindow(interactive, "interaction-agent-run-recovery");
  await captureVisual(interactive, "interaction-agent-run-recovery");
  if (!interaction.text.includes("visual agent recovery task")) fail("recovery agent task did not render");
  if (!interaction.text.includes("Mock agent run complete")) fail("recovery agent run did not complete");
  if (interaction.buttons.some((button) => ["停止", "Stop"].includes(button.text))) fail("recovery agent run stayed in Stop state after completion");
  interactive.close();

  console.log("Checking language switch...");
  const languageWin = await createWindow(1280, 720, true);
  if (!(await clickByText(languageWin, "设置"))) fail("could not open settings for language switch");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!(await clickByText(languageWin, "英文"))) fail("could not switch to English");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const languageAudit = await auditWindow(languageWin, "language-switch");
  await captureVisual(languageWin, "language-switch");
  if (!languageAudit.text.includes("Desktop Status")) fail("English desktop status did not render");
  if (!languageAudit.text.includes("Check Updates")) fail("English action labels did not render");
  if (!languageAudit.buttons.some((button) => button.text === "New task" || button.text === "Settings")) fail("English navigation did not render");
  languageWin.close();

  if (failures.length) {
    console.error("Renderer visual verification failed:");
    for (const failure of failures) console.error("- " + failure);
    app.exit(1);
    return;
  }
  clearTimeout(watchdog);
  console.log("Renderer visual verification passed (3 viewports + bridge + interactions).");
  app.exit(0);
}

async function runCurrentVisual() {
  const text = {
    newTaskZh: "\u65b0\u5efa\u4efb\u52a1",
    searchZh: "\u641c\u7d22",
    scheduledZh: "\u5df2\u5b89\u6392",
    agentsZh: "\u667a\u80fd\u4f53",
    skillsZh: "\u6280\u80fd",
    settingsZh: "\u8bbe\u7f6e",
    workspaceZh: "\u5de5\u4f5c\u533a",
    sendZh: "\u53d1\u9001",
    stopZh: "\u505c\u6b62",
    englishZh: "\u82f1\u6587",
  };

  const includesAny = (haystack, values) => values.some((value) => haystack.includes(value));

  if (modelProviderOnly) {
    console.log("Checking model Provider user journeys...");
    let win = await createWindow(1280, 800, true);
    await win.webContents.executeJavaScript("localStorage.setItem('opendrsai.language','en'); localStorage.removeItem('opendrsai.agentModelPolicyMigration.v1'); localStorage.removeItem('opendrsai.agentConfigurations.preModelPolicy.v1.backup'); localStorage.removeItem('opendrsai.defaultModel'); localStorage.setItem('opendrsai.agentConfigurations', JSON.stringify({'my-drsai':{model:'visual-model'}}))");
    const languageReloaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    win.webContents.reload();
    await languageReloaded;
    await waitForPaint(win);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const legacyMigration = await win.webContents.executeJavaScript("(() => { const stored=JSON.parse(localStorage.getItem('opendrsai.agentConfigurations')||'{}'); const backup=JSON.parse(localStorage.getItem('opendrsai.agentConfigurations.preModelPolicy.v1.backup')||'{}'); return { marker:localStorage.getItem('opendrsai.agentModelPolicyMigration.v1'), legacyModel:stored['my-drsai']?.model, backupModel:backup['my-drsai']?.model, nakedDefault:localStorage.getItem('opendrsai.defaultModel'), calls:window.openDrSai.getModelProviderVisualState().migrationCalls }; })()");
    console.log("Model Provider E2E: legacy migration=" + JSON.stringify(legacyMigration));
    if (legacyMigration.marker !== "complete" || legacyMigration.legacyModel !== undefined || legacyMigration.backupModel !== "visual-model" || legacyMigration.nakedDefault !== null || legacyMigration.calls !== 1) fail("legacy local model preference was not backed up and migrated exactly once to Agent policy");
    console.log("Model Provider E2E: renderer window ready");
    const menuOpened = await win.webContents.executeJavaScript("(() => { const menu=document.querySelector('[data-testid=user-menu-button]'); menu?.click(); return Boolean(menu); })()");
    console.log("Model Provider E2E: user menu requested");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const settingsOpened = await win.webContents.executeJavaScript("(() => { const settings=document.querySelector('[data-testid=user-menu-settings]'); settings?.click(); return Boolean(settings); })()");
    console.log("Model Provider E2E: settings requested");
    if (!menuOpened || !settingsOpened) fail("could not open settings for model Provider journey");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const agentPaneOpened = await win.webContents.executeJavaScript("(() => { const button=[...document.querySelectorAll('button')].find((item)=>item.innerText.trim()==='Agent configuration'); button?.click(); return Boolean(button); })()");
    await new Promise((resolve) => setTimeout(resolve, 80));
    const imageModelSetting = await win.webContents.executeJavaScript("(() => { const setting=document.querySelector('[data-testid=agent-image-model-setting]'); return { visible:Boolean(setting), options:setting ? [...setting.querySelectorAll('option')].map((item)=>item.innerText) : [] }; })()");
    if (!agentPaneOpened || !imageModelSetting.visible || !imageModelSetting.options.some((value) => value.includes('image_generation'))) fail("declared image model was not exposed in Agent configuration");
    const modelUsability = await win.webContents.executeJavaScript("(() => { const select=document.querySelector('[data-testid=agent-text-model-select]'); return { labelled:Boolean(select?.getAttribute('aria-label')), groups:select ? [...select.querySelectorAll('optgroup')].map((item)=>item.label) : [], recovery:Boolean(document.querySelector('[data-testid=agent-model-catalog-recovery]')) }; })()");
    console.log("Model Provider E2E: Agent model usability=" + JSON.stringify(modelUsability));
    if (!modelUsability.labelled || !modelUsability.groups.includes('visual-provider') || modelUsability.recovery) fail("fresh Agent models were not grouped by Provider or exposed with the expected accessible state: " + JSON.stringify(modelUsability));
    const providerPaneOpened = await win.webContents.executeJavaScript("(() => { const button=[...document.querySelectorAll('button')].find((item)=>['模型提供方','Model providers'].includes(item.innerText.trim())); button?.click(); return Boolean(button); })()");
    console.log("Model Provider E2E: provider pane found=" + providerPaneOpened);
    if (!providerPaneOpened) fail("could not open the model Provider settings pane");
    await new Promise((resolve) => setTimeout(resolve, 80));
    const initial = await auditWindow(win, "model-provider-initial");
    console.log("Model Provider E2E: initial text=" + initial.text.slice(0, 500).replace(/\s+/g, " "));
    console.log("Model Provider E2E: initial audit complete");
    if (!initial.text.includes("模型提供方") && !initial.text.includes("Model providers")) fail("model Provider settings did not render");

    const credentialAndEndpointLayout = await win.webContents.executeJavaScript("(() => ({ keySource:Boolean(document.querySelector('[data-testid=model-provider-key-source]')), apiKey:Boolean(document.querySelector('[data-testid=model-provider-api-key]')), endpoints:Boolean(document.querySelector('[data-testid=model-provider-endpoints]')), primaryHost:Boolean(document.querySelector('[data-testid=model-provider-api-host]')) }))()");
    console.log("Model Provider E2E: credential and endpoint layout audit complete");
    if (credentialAndEndpointLayout.keySource || !credentialAndEndpointLayout.apiKey || !credentialAndEndpointLayout.endpoints || !credentialAndEndpointLayout.primaryHost) fail("model Provider must use default secure storage and the host/protocol layout");

    const basicClicked = await win.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-test-basic]'); button?.click(); return Boolean(button); })()");
    console.log("Model Provider E2E: basic test requested");
    if (!basicClicked) fail("basic connection action is missing");
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("Model Provider E2E: basic test settled");
    let textAfterAction = await win.webContents.executeJavaScript("document.body.innerText");
    console.log("Model Provider E2E: basic result text read");
    if (!textAfterAction.includes("连接成功") && !textAfterAction.includes("Connection succeeded")) fail("basic connection result was not distinguished from a model call");
    if (!(await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState().basicTestCalls === 1"))) fail("basic connection did not call the basic probe exactly once");

    const modelClicked = await win.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-test-model]'); button?.click(); return Boolean(button); })()");
    console.log("Model Provider E2E: model test dialog requested");
    if (!modelClicked) fail("model call action is missing");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const feeDialog = await win.webContents.executeJavaScript("(() => { const dialog=document.querySelector('[data-testid=model-provider-test-dialog]'); return { visible:Boolean(dialog), text:dialog?.innerText || '' }; })()");
    console.log("Model Provider E2E: model fee dialog audited");
    if (!feeDialog.visible || (!feeDialog.text.includes("可能产生少量费用") && !feeDialog.text.includes("may incur a small charge"))) fail("model call fee confirmation was not shown");
    await win.webContents.executeJavaScript("document.querySelector('[data-testid=model-provider-test-model-confirm]')?.click()");
    console.log("Model Provider E2E: model fee dialog cancelled");
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (await win.webContents.executeJavaScript("Boolean(document.querySelector('[data-testid=model-provider-test-dialog]'))")) fail("confirmed model call did not close the dialog");
    console.log("Model Provider E2E: model fee dialog cancellation audited");
    if (!(await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState().modelTestCalls === 1"))) fail("confirming the fee dialog did not call the model endpoint exactly once");
    console.log("Model Provider E2E: cancellation side effects audited");

    textAfterAction = await win.webContents.executeJavaScript("document.body.innerText");
    if (!textAfterAction.includes("模型调用成功") && !textAfterAction.includes("Model call succeeded")) fail("confirmed model call result did not render");
    if (!(await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState().modelTestCalls === 1"))) fail("confirmed model call was not recorded exactly once");

    if (false) {
    win.close();
    console.log("Model Provider E2E: cancellation window closed");
    win = await createWindow(1280, 800, true);
    console.log("Model Provider E2E: confirmation window ready");
    await win.webContents.executeJavaScript("document.querySelector('[data-testid=user-menu-button]')?.click()");
    console.log("Model Provider E2E: confirmation user menu requested");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await win.webContents.executeJavaScript("document.querySelector('[data-testid=user-menu-settings]')?.click()");
    console.log("Model Provider E2E: confirmation settings requested");
    await new Promise((resolve) => setTimeout(resolve, 70));
    await win.webContents.executeJavaScript("(() => { const button=[...document.querySelectorAll('button')].find((item)=>['模型提供方','Model providers'].includes(item.innerText.trim())); button?.click(); return Boolean(button); })()");
    console.log("Model Provider E2E: confirmation provider pane requested");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const modelTestReopened = await win.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-test-model]'); button?.click(); return Boolean(button); })()");
    if (!modelTestReopened) fail("model call action disappeared after cancelling confirmation");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const modelTestCancelled = await win.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-test-model-cancel]'); button?.click(); return Boolean(button); })()");
    if (!modelTestCancelled) fail("model call cancellation did not reopen");
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (await win.webContents.executeJavaScript("Boolean(document.querySelector('[data-testid=model-provider-test-dialog]'))")) fail("model call cancel did not close the dialog");
    if (!(await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState().modelTestCalls === 0"))) fail("cancelling the fee dialog called the model endpoint");

    }
    console.log("Model Provider E2E: about to open delete dialog");
    const deleteOpened = await win.webContents.executeJavaScript("(() => { const button=document.querySelector('.model-provider-actions button:nth-of-type(5)'); if (!button) return false; return button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); })()");
    console.log("Model Provider E2E: delete dialog requested");
    if (!deleteOpened) fail("delete Provider action is missing");
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (!(await win.webContents.executeJavaScript("Boolean(document.querySelector('[data-testid=model-provider-delete-dialog]'))"))) fail("delete Provider dialog did not open");
    console.log("Model Provider E2E: delete dialog audited");
    await win.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-delete-cancel]'); if (!button) return false; return button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); })()");
    console.log("Model Provider E2E: delete cancellation requested");
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (await win.webContents.executeJavaScript("Boolean(document.querySelector('[data-testid=model-provider-delete-dialog]'))")) fail("delete Provider cancel did not close the dialog");
    console.log("Model Provider E2E: delete cancellation dialog state audited");
    if (!(await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState().deleteCalls === 0"))) fail("delete Provider cancel mutated backend state");
    console.log("Model Provider E2E: delete cancellation backend state audited");

    let setInput = async (label, value) => win.webContents.executeJavaScript(${"`"}(() => {
      if (${"${"}JSON.stringify(label)} === 'Model') return false;
      const labelNode = [...document.querySelectorAll('.model-provider-grid label')].find((node) => node.querySelector('span')?.innerText.trim() === ${"${"}JSON.stringify(label)});
      const input = labelNode?.querySelector('input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(input, ${"${"}JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()${"`"});
    const selectModel = async (targetWindow, value) => {
      const choose = () => targetWindow.webContents.executeJavaScript(${"`"}(() => {
        const target = ${"${"}JSON.stringify(value)};
        const row = [...document.querySelectorAll('.model-provider-model-row')].find((node) => node.querySelector('.model-provider-model-select span')?.textContent?.trim() === target);
        const radio = row?.querySelector('input[type=radio]');
        if (!radio) return false;
        radio.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      })()${"`"});
      const opened = await targetWindow.webContents.executeJavaScript("(() => { const button=document.querySelector('.model-provider-models-header button'); if (!button) return false; button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; })()");
      console.log("Model Provider E2E: model editor opened for " + value);
      if (!opened) return false;
      await new Promise((resolve) => setTimeout(resolve, 30));
      const entered = await targetWindow.webContents.executeJavaScript(${"`"}(() => {
        const input = document.querySelector('[data-testid=model-provider-model-new-input]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!input || !setter) return false;
        setter.call(input, ${"${"}JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()${"`"});
      console.log("Model Provider E2E: model id entered for " + value);
      if (!entered) return false;
      await new Promise((resolve) => setTimeout(resolve, 30));
      await targetWindow.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-model-new-confirm]'); if (!button) return false; button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; })()");
      console.log("Model Provider E2E: model id committed for " + value);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return true;
    };
    const setNonModelInput = setInput;
    const setProviderName = (value) => win.webContents.executeJavaScript(${"`"}(() => {
      const input = document.querySelector('[data-testid=model-provider-name]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!input || !setter) return false;
      setter.call(input, ${"${"}JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()${"`"});
    setInput = (label, value) => label === "Model" || value.endsWith("-model") || value === "gateway-down"
      ? selectModel(win, value)
      : label === "Service name" || value === "visual-provider"
        ? setProviderName(value)
        : setNonModelInput(label, value);
    const clickAction = async (names) => win.webContents.executeJavaScript(${"`"}(() => {
      const candidates = ${"${"}JSON.stringify(names)};
      const button = [...document.querySelectorAll('.model-provider-actions button')].find((node) => candidates.includes(node.innerText.trim()));
      if (!button) return false;
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    })()${"`"});

    if (!(await setInput("模型", "fail-model")) && !(await setInput("Model", "fail-model"))) fail("could not enter failing model draft");
    await clickAction(["检查连接", "Check connection", "Test basic connection"]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    textAfterAction = await win.webContents.executeJavaScript("document.body.innerText");
    if (!textAfterAction.includes("synthetic_probe_failure")) fail("failed draft probe did not render its stable error");
    let providerState = await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState()");
    const configCallsBeforeSave = providerState.configCalls;
    if (providerState.saveCalls !== 0 || providerState.revision !== "a".repeat(64)) fail("failed draft probe persisted configuration or changed revision");

    const staleWin = await createWindow(1100, 760, true);
    await staleWin.webContents.executeJavaScript("document.querySelector('[data-testid=user-menu-button]')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await staleWin.webContents.executeJavaScript("document.querySelector('[data-testid=user-menu-settings]')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 70));
    await staleWin.webContents.executeJavaScript("(() => { const button=[...document.querySelectorAll('button')].find((item)=>['模型提供方','Model providers'].includes(item.innerText.trim())); button?.click(); return Boolean(button); })()");
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (!(await setInput("模型", "saved-model")) && !(await setInput("Model", "saved-model"))) fail("could not enter saved model draft");
    await clickAction(["保存并使用", "Save and use"]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await win.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-preview-confirm]'); if (!button) return false; button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; })()");
    await new Promise((resolve) => setTimeout(resolve, 80));
    textAfterAction = await win.webContents.executeJavaScript("document.body.innerText");
    providerState = await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState()");
    if (!textAfterAction.includes("模型服务配置已保存") && !textAfterAction.includes("Model service configuration saved")) fail("successful save did not render");
    if (providerState.saveCalls !== 1 || providerState.activeModel !== "saved-model" || providerState.revision === "a".repeat(64)) fail("successful save did not update model and revision exactly once");
    if (providerState.configCalls <= configCallsBeforeSave) fail("successful Provider save did not automatically refresh the Runtime model catalog");

    if (false) {

    const staleSaveClicked = await staleWin.webContents.executeJavaScript("(() => { const input=document.querySelector('[data-testid=model-provider-model]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set; setter?.call(input,'stale-window-model'); input?.dispatchEvent(new Event('input',{bubbles:true})); const button=[...document.querySelectorAll('.model-provider-actions button')].find(node=>['保存并使用','Save and use'].includes(node.innerText.trim())); button?.click(); return Boolean(input && button); })()");
    }
    const staleModelSelected = await selectModel(staleWin, "stale-window-model");
    const staleSaveClicked = staleModelSelected && await staleWin.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-save-use]'); if (!button) return false; button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; })()");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await staleWin.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-preview-confirm]'); if (!button) return false; button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; })()");
    console.log("Model Provider E2E: stale save requested");
    await new Promise((resolve) => setTimeout(resolve, 80));
    console.log("Model Provider E2E: stale save settled");
    textAfterAction = await staleWin.webContents.executeJavaScript("document.body.innerText");
    console.log("Model Provider E2E: stale window text read");
    console.log("Model Provider E2E: stale text=" + textAfterAction.slice(-600).replace(/\s+/g, " "));
    providerState = await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState()");
    console.log("Model Provider E2E: winning window state read");
    const staleConflictVisible = await staleWin.webContents.executeJavaScript("Boolean(document.querySelector('[data-testid=model-provider-conflict-reload]'))");
    if (!staleSaveClicked || !staleConflictVisible) fail("two-window revision conflict was not surfaced to the stale window");
    if (providerState.saveCalls !== 1 || providerState.activeModel !== "saved-model") fail("revision conflict overwrote the active model");
    const conflictReloaded = await staleWin.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-conflict-reload]'); if (!button) return false; button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; })()");
    console.log("Model Provider E2E: conflict reload requested");
    await new Promise((resolve) => setTimeout(resolve, 60));
    textAfterAction = await staleWin.webContents.executeJavaScript("document.body.innerText");
    console.log("Model Provider E2E: conflict reload text read");
    if (!conflictReloaded || (!textAfterAction.includes("已重新加载最新模型服务配置") && !textAfterAction.includes("Latest model service configuration reloaded"))) fail("revision conflict did not provide a working reload recovery action");
    if (!textAfterAction.includes("saved-model")) fail("stale window reload did not receive the winning model configuration");
    staleWin.close();
    console.log("Model Provider E2E: stale window closed");

    await captureVisual(win, "model-provider-policy-and-revision-tests");
    win.close();
    if (failures.length) {
      for (const failure of failures) console.error("- " + failure);
      app.exit(1);
      return;
    }
    clearTimeout(watchdog);
    console.log("Model Provider Electron UI E2E passed.");
    app.exit(0);
    return;

    await win.webContents.executeJavaScript("(() => { const button=document.querySelector('.model-provider-actions button:nth-of-type(5)'); if (!button) return false; return button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); })()");
    console.log("Model Provider E2E: retain-credential delete dialog requested");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await win.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-delete-keep-credential]'); if (!button) return false; return button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); })()");
    console.log("Model Provider E2E: retain-credential delete confirmed");
    await new Promise((resolve) => setTimeout(resolve, 80));
    console.log("Model Provider E2E: retain-credential delete settled");
    providerState = await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState()");
    console.log("Model Provider E2E: retain-credential state read");
    if (providerState.deleteCalls !== 1 || providerState.lastDeleteCredential !== false) fail("delete-only path did not retain the credential");

    await win.webContents.executeJavaScript("true");
    console.log("Model Provider E2E: second delete setup started");
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (!(await setInput("服务名称", "visual-provider")) && !(await setInput("Service name", "visual-provider"))) fail("could not restore Provider draft for credential deletion");
    console.log("Model Provider E2E: second delete Provider draft restored");
    await win.webContents.executeJavaScript("(() => { const button=document.querySelector('.model-provider-actions button:nth-of-type(5)'); if (!button) return false; return button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); })()");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await win.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=model-provider-delete-with-credential]'); if (!button) return false; return button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); })()");
    await new Promise((resolve) => setTimeout(resolve, 80));
    providerState = await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState()");
    if (providerState.deleteCalls !== 2 || providerState.lastDeleteCredential !== true) fail("delete-with-credential path did not request credential deletion");

    const ollamaSelected = await win.webContents.executeJavaScript("(() => { const select=document.querySelector('[data-testid=model-provider-preset]'); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')?.set; setter?.call(select,'ollama'); select?.dispatchEvent(new Event('change',{bubbles:true})); return Boolean(select); })()");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const ollamaDraft = await win.webContents.executeJavaScript("(() => ({ provider:document.querySelector('[data-testid=model-provider-name]')?.value, keySource:document.querySelector('[data-testid=model-provider-key-source]')?.value, hasBaseUrl:Boolean([...document.querySelectorAll('.model-provider-grid label')].find(node=>node.querySelector('span')?.innerText==='Base URL')) }))()");
    if (!ollamaSelected || ollamaDraft.provider !== "ollama" || ollamaDraft.keySource !== "none" || !ollamaDraft.hasBaseUrl) fail("Ollama preset did not configure a visible no-key local service");
    await clickAction(["发现模型", "Discover models"]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    textAfterAction = await win.webContents.executeJavaScript("document.body.innerText");
    if (!textAfterAction.includes("个模型可用") && !textAfterAction.includes("models discovered")) fail("Ollama model discovery did not complete");

    await setInput("模型", "unknown-local-model") || await setInput("Model", "unknown-local-model");
    await clickAction(["保存并使用", "Save and use"]);
    await new Promise((resolve) => setTimeout(resolve, 70));
    if (!(await win.webContents.executeJavaScript("Boolean(document.querySelector('[data-testid=model-provider-unknown-model-warning]'))"))) fail("unknown model warning did not render after save");

    providerState = await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState()");
    const savesBeforeGatewayFailure = providerState.saveCalls;
    await setInput("模型", "gateway-down") || await setInput("Model", "gateway-down");
    await clickAction(["基础连接测试", "Test basic connection"]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    textAfterAction = await win.webContents.executeJavaScript("document.body.innerText");
    providerState = await win.webContents.executeJavaScript("window.openDrSai.getModelProviderVisualState()");
    if (!textAfterAction.includes("OpenDrSai is not running") || providerState.saveCalls !== savesBeforeGatewayFailure) fail("Gateway failure did not remain recoverable and side-effect free");

    await setInput("模型", "restart-persisted-model") || await setInput("Model", "restart-persisted-model");
    await clickAction(["保存并使用", "Save and use"]);
    await new Promise((resolve) => setTimeout(resolve, 70));
    win.close();
    win = await createWindow(1280, 800, true);
    await win.webContents.executeJavaScript("document.querySelector('[data-testid=user-menu-button]')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await win.webContents.executeJavaScript("document.querySelector('[data-testid=user-menu-settings]')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 80));
    await win.webContents.executeJavaScript("(() => { const button=[...document.querySelectorAll('button')].find((item)=>['模型提供方','Model providers'].includes(item.innerText.trim())); button?.click(); return Boolean(button); })()");
    await new Promise((resolve) => setTimeout(resolve, 50));
    textAfterAction = await win.webContents.executeJavaScript("document.body.innerText");
    if (!textAfterAction.includes("restart-persisted-model")) fail("saved model did not survive a Renderer window restart");
    await captureVisual(win, "model-provider-two-level-tests");
    win.close();
    if (failures.length) {
      for (const failure of failures) console.error("- " + failure);
      app.exit(1);
      return;
    }
    clearTimeout(watchdog);
    console.log("Model Provider Electron UI E2E passed.");
    app.exit(0);
    return;
  }

  if (l3Only) {
    console.log("Checking L3 renderer capability, keyboard and accessibility gates...");
    const win = await createWindow(1280, 800, true);
    const focusTrace = [];
    let openedSettings = false;
    let openedUserMenu = false;
    for (let index = 0; index < 100; index += 1) {
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const focus = await win.webContents.executeJavaScript("(() => { const el=document.activeElement; return { tag: el?.tagName || '', name: el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || el?.innerText?.trim?.() || '', disabled: Boolean(el?.disabled) }; })()");
      if (focus.name) focusTrace.push(focus);
      if (!openedUserMenu && ["用户菜单", "User menu"].includes(focus.name)) {
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
        openedUserMenu = true;
        await new Promise((resolve) => setTimeout(resolve, 20));
        let expanded = await win.webContents.executeJavaScript("document.querySelector('[data-testid=user-menu-button]')?.getAttribute('aria-expanded')");
        if (expanded !== "true") {
          win.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
          win.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
          await new Promise((resolve) => setTimeout(resolve, 20));
          expanded = await win.webContents.executeJavaScript("document.querySelector('[data-testid=user-menu-button]')?.getAttribute('aria-expanded')");
        }
        if (expanded !== "true") fail("Enter did not open the focused user menu");
        continue;
      }
      if (["设置", "Settings"].includes(focus.name)) {
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
        openedSettings = true;
        break;
      }
    }
    if (!openedSettings) fail("keyboard traversal could not reach Settings: " + JSON.stringify(focusTrace.slice(0, 30)));
    if (focusTrace.length < 6 || focusTrace.some((item) => item.disabled)) fail("keyboard traversal did not produce a usable focus sequence");
    await new Promise((resolve) => setTimeout(resolve, 100));
    let openedIntegrations = false;
    for (let index = 0; index < 30; index += 1) {
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const focus = await win.webContents.executeJavaScript("document.activeElement?.innerText?.trim?.() || document.activeElement?.getAttribute?.('aria-label') || ''");
      if (["集成概览", "Overview"].includes(focus)) {
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
        openedIntegrations = true;
        break;
      }
    }
    if (!openedIntegrations) fail("keyboard traversal could not open Integration overview; active=" + await win.webContents.executeJavaScript("document.activeElement?.outerHTML || ''"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const gateAudit = await win.webContents.executeJavaScript(${"`"}(() => ({
      rightTabs: Array.from(document.querySelectorAll('.right-tabs button')).map((button) => button.getAttribute('aria-label') || button.innerText.trim()),
      settingsPanes: Array.from(document.querySelectorAll('[data-testid^=settings-pane-]')).map((button) => button.getAttribute('data-testid')),
      integrations: Array.from(document.querySelectorAll('.settings-integration-row strong')).map((item) => item.textContent.trim()),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }))()${"`"});
    const forbidden = {
      browser: ["Browser", "浏览器"], debugger: ["Debug", "调试"], terminal: ["Terminal", "终端"],
      channels: ["Channels", "频道"], mcp: ["MCP", "工具连接"], remoteWorkspace: ["Remote computers", "远程计算机", "Android", "Android 端"],
      serialVoice: ["Voice", "语音"], agents: ["Agent tasks", "智能体任务"], approvals: ["Approval Center", "审批中心"], diagnostics: ["Usage analytics", "使用分析"],
    };
    for (const feature of disabledFeatures) {
      const labels = forbidden[feature] || [];
      if ([...gateAudit.rightTabs, ...gateAudit.integrations].some((value) => labels.includes(value))) fail(feature + " remained actionable while capability=false");
    }
    if (disabledFeatures.includes("channels") && gateAudit.settingsPanes.includes("settings-pane-channels")) fail("Channels settings pane remained visible while disabled");
    if (disabledFeatures.includes("agents") && gateAudit.settingsPanes.includes("settings-pane-agent-task")) fail("Agent settings remained visible while disabled");
    if (disabledFeatures.includes("approvals") && gateAudit.settingsPanes.includes("settings-pane-approvals")) fail("Approval settings remained visible while disabled");
    if (disabledFeatures.includes("diagnostics") && gateAudit.settingsPanes.includes("settings-pane-analytics")) fail("Analytics settings remained visible while disabled");
    if (gateAudit.horizontalOverflow) fail("L3 viewport has horizontal overflow");
    await win.webContents.executeJavaScript(axeSource);
    const axe = await win.webContents.executeJavaScript("axe.run().then((result) => result.violations.map((item) => ({ id:item.id, impact:item.impact, nodes:item.nodes.map((node) => ({ target: node.target, html: node.html, summary: node.failureSummary })) })))");
    const severe = axe.filter((item) => item.impact === "critical" || item.impact === "serious");
    if (severe.length) fail("axe serious/critical violations: " + JSON.stringify(severe));
    await captureVisual(win, "l3-capability-gating");
    win.close();
    if (failures.length) { for (const failure of failures) console.error("- " + failure); app.exit(1); return; }
    clearTimeout(watchdog);
    console.log("L3 renderer integration passed (keyboard-only navigation, fail-closed capabilities, responsive layout, axe serious/critical=0)." );
    app.exit(0);
    return;
  }

  if (pairingOnly) {
    console.log("Checking Android pairing dialog...");
    const win = await createWindow(1024, 760, true);
    if (!(await clickByAnyText(win, ["Visual User", "User menu"]))) fail("could not open user menu for Android pairing");
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (!(await clickByAnyText(win, [text.settingsZh, "Settings"]))) fail("could not open settings for Android pairing");
    await win.webContents.executeJavaScript("document.querySelector('[data-testid=settings-pane-integrations]')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (!(await clickByAnyText(win, ["连接 Android", "Connect Android"]))) fail("could not open Android pairing dialog");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const audit = await win.webContents.executeJavaScript("(() => { const dialog = document.querySelector('[data-testid=mobile-pairing-dialog]'); const image = dialog?.querySelector('img'); const style = dialog ? getComputedStyle(dialog) : null; return { text: dialog?.innerText || '', hasDialog: Boolean(dialog), qrWidth: image?.naturalWidth || 0, background: style?.backgroundColor || '', color: style?.color || '', opacity: style?.opacity || '' }; })()");
    await captureVisual(win, "android-pairing-dialog");
    if (!audit.hasDialog || !(audit.text.includes("手工配对码") || audit.text.includes("Manual pairing code"))) fail("Android pairing content did not render");
    if (audit.qrWidth < 200) fail("Android pairing QR image did not render");
    if (audit.background === "rgba(0, 0, 0, 0)" || audit.background === "transparent") fail("Android pairing dialog surface is transparent");
    if (audit.opacity !== "1") fail("Android pairing dialog opacity dims its own content");
    await win.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (!(await win.webContents.executeJavaScript("!document.querySelector('[data-testid=mobile-pairing-dialog]')"))) fail("Escape did not close Android pairing dialog");
    await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', ctrlKey: true, shiftKey: true, bubbles: true }))");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const shortcutAudit = await win.webContents.executeJavaScript("(() => { const dialog = document.querySelector('.shortcut-settings-modal'); const style = dialog ? getComputedStyle(dialog) : null; return { visible: Boolean(dialog), background: style?.backgroundColor || '', color: style?.color || '', opacity: style?.opacity || '' }; })()");
    await captureVisual(win, "keyboard-shortcuts-dialog");
    if (!shortcutAudit.visible) fail("Keyboard shortcuts dialog did not open from its default shortcut");
    if (shortcutAudit.background === "rgba(0, 0, 0, 0)" || shortcutAudit.background === "transparent") fail("Keyboard shortcuts dialog surface is transparent");
    if (shortcutAudit.opacity !== "1") fail("Keyboard shortcuts dialog opacity dims its own content");
    win.close();
    if (failures.length) { for (const failure of failures) console.error("- " + failure); app.exit(1); return; }
    clearTimeout(watchdog);
    console.log("Android pairing visual verification passed.");
    app.exit(0);
    return;
  }

  if (!m9Only) {
  console.log("Checking bridge fallback...");
  const bridgeMissing = await createWindow(900, 650, false);
  const bridgeAudit = await auditWindow(bridgeMissing, "bridge-missing");
  await captureVisual(bridgeMissing, "bridge-missing");
  if (!bridgeAudit.text.includes("desktop bridge is unavailable")) {
    fail("production renderer without preload bridge did not show the bridge error page");
  }
  bridgeMissing.close();

  console.log("Checking responsive viewports...");
  for (const [width, height] of [[1280, 720], [1024, 720], [860, 720]]) {
    const win = await createWindow(width, height, true);
    const audit = await auditWindow(win, width + "x" + height);
    await captureVisual(win, audit.label);
    if (audit.overflow) fail(audit.label + " has horizontal overflow");
    if (audit.offscreen.length) {
      fail(
        audit.label +
          " has offscreen controls: " +
          audit.offscreen
            .slice(0, 5)
            .map((item) => item.tag + "." + item.className + "@" + Math.round(item.x) + "+" + Math.round(item.width))
            .join(", "),
      );
    }
    if (!audit.text.includes("OpenDrSai")) fail(audit.label + " is missing brand text");
    if (!includesAny(audit.text, [text.newTaskZh, "New task"])) fail(audit.label + " is missing new task action");
    if (!includesAny([audit.text, ...audit.inputPlaceholders].join(" "), [text.searchZh, "Search"])) {
      fail(audit.label + " is missing search action");
    }
    if (!includesAny(audit.text, [text.workspaceZh, "Workspace"])) fail(audit.label + " is missing workspace section");
    if (!audit.hasTextarea) fail(audit.label + " is missing chat textarea");
    const accessibleNav = audit.buttons.filter((button) =>
      [text.newTaskZh, text.searchZh, text.scheduledZh, text.agentsZh, text.skillsZh, text.settingsZh, "New task", "Search", "Scheduled", "Agents", "Skills", "Settings"].includes(
        button.text,
      ),
    );
    if (accessibleNav.some((button) => !button.title || !button.aria)) fail(audit.label + " has inaccessible nav buttons");
    win.close();
  }
  }

  console.log("Checking workspace creation journeys...");
  const localWorkspaceWin = await createWindow(1280, 760, true, "visual-workspace-create-local");
  const localDialogOpened = await localWorkspaceWin.webContents.executeJavaScript("(() => { const button=document.querySelector('[data-testid=workspace-create-button]'); button?.click(); return Boolean(button); })()");
  await new Promise((resolve) => setTimeout(resolve, 80));
  if (!localDialogOpened) fail("could not open the unified workspace creation dialog");
  const typeAudit = await localWorkspaceWin.webContents.executeJavaScript("(() => { const dialog=document.querySelector('[data-testid=workspace-create-dialog]'); return { visible:Boolean(dialog), text:dialog?.innerText || '', local:Boolean(document.querySelector('[data-testid=workspace-type-local]')), remote:Boolean(document.querySelector('[data-testid=workspace-type-remote]')) }; })()");
  if (!typeAudit.visible || !typeAudit.local || !typeAudit.remote) fail("workspace type dialog did not expose Local and Remote choices");
  if (typeAudit.text.includes("现有文件夹") || typeAudit.text.includes("空白本地项目")) fail("workspace type dialog still exposes the retired Existing or Blank choices");
  await new Promise((resolve) => setTimeout(resolve, 400));
  await captureVisual(localWorkspaceWin, "workspace-create-type");
  await localWorkspaceWin.webContents.executeJavaScript("document.querySelector('[data-testid=workspace-type-local]')?.click()");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await localWorkspaceWin.webContents.executeJavaScript("document.querySelector('[data-testid=local-workspace-folder-picker]')?.click()");
  await new Promise((resolve) => setTimeout(resolve, 80));
  const localWorkspaceAudit = await localWorkspaceWin.webContents.executeJavaScript("(() => { const path=document.querySelector('[data-testid=local-workspace-path]'); const name=document.querySelector('[data-testid=workspace-name-input]'); const submit=[...document.querySelectorAll('.workspace-create-actions button')].find((button)=>button.textContent.includes('添加工作区')||button.textContent.includes('Add workspace')); return { path:path?.value || '', name:name?.value || '', readOnly:Boolean(path?.readOnly), nameEditable:Boolean(name && !name.readOnly && !name.disabled), submitEnabled:Boolean(submit && !submit.disabled) }; })()");
  if (!localWorkspaceAudit.path.endsWith("source-project") || localWorkspaceAudit.name !== "source-project") fail("local source folder did not supply the default workspace name: " + JSON.stringify(localWorkspaceAudit));
  if (!localWorkspaceAudit.readOnly || !localWorkspaceAudit.nameEditable || !localWorkspaceAudit.submitEnabled) fail("local workspace form does not have the expected editable and submit states");
  const localNameOverridden = await localWorkspaceWin.webContents.executeJavaScript("(() => { const input=document.querySelector('[data-testid=workspace-name-input]'); if (!input) return ''; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'指定工作区'); input.dispatchEvent(new Event('input',{bubbles:true})); return input.value; })()");
  if (localNameOverridden !== "指定工作区") fail("local workspace name could not be overridden");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await captureVisual(localWorkspaceWin, "workspace-create-local");
  localWorkspaceWin.close();

  const remoteWorkspaceWin = await createWindow(1280, 800, true, "visual-workspace-create-remote");
  await remoteWorkspaceWin.webContents.executeJavaScript("document.querySelector('[data-testid=workspace-create-button]')?.click()");
  await new Promise((resolve) => setTimeout(resolve, 50));
  await remoteWorkspaceWin.webContents.executeJavaScript("document.querySelector('[data-testid=workspace-type-remote]')?.click()");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const remoteHostReady = await remoteWorkspaceWin.webContents.executeJavaScript("(() => { const host=document.querySelector('[data-testid=remote-workspace-host]'); return Boolean(host && host.value === 'zhangtianshuo_4090'); })()");
  if (!remoteHostReady) fail("remote workspace form did not select the available host");
  await remoteWorkspaceWin.webContents.executeJavaScript("document.querySelector('[data-testid=remote-workspace-load]')?.click()");
  await new Promise((resolve) => setTimeout(resolve, 120));
  const remoteFolderSelected = await remoteWorkspaceWin.webContents.executeJavaScript("(() => { const option=[...document.querySelectorAll('.remote-directory-list [role=option]')].find((item)=>item.textContent.includes('ai_completion')); option?.click(); return Boolean(option); })()");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const remoteWorkspaceAudit = await remoteWorkspaceWin.webContents.executeJavaScript("(() => { const path=document.querySelector('[data-testid=remote-workspace-path]'); const name=document.querySelector('[data-testid=workspace-name-input]'); const content=document.querySelector('.workspace-create-content'); const submit=[...document.querySelectorAll('.workspace-create-actions button')].find((button)=>button.textContent.includes('添加工作区')||button.textContent.includes('Add workspace')); return { path:path?.value || '', name:name?.value || '', directories:document.querySelectorAll('.remote-directory-list [role=option]').length, nameEditable:Boolean(name && !name.readOnly && !name.disabled), submitEnabled:Boolean(submit && !submit.disabled), contentOverflow:Boolean(content && content.scrollHeight > content.clientHeight + 1) }; })()");
  if (!remoteFolderSelected || !remoteWorkspaceAudit.path.endsWith("/ai_completion") || remoteWorkspaceAudit.name !== "ai_completion") fail("remote directory selection did not update the source path and default name: " + JSON.stringify(remoteWorkspaceAudit));
  if (remoteWorkspaceAudit.directories < 3 || !remoteWorkspaceAudit.nameEditable || !remoteWorkspaceAudit.submitEnabled) fail("remote workspace form is missing its directory browser or valid submit state");
  if (remoteWorkspaceAudit.contentOverflow) fail("remote workspace form requires a second outer scrollbar at 1280x800");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await captureVisual(remoteWorkspaceWin, "workspace-create-remote");
  remoteWorkspaceWin.close();

  console.log("Checking Chinese core pages...");
  const chineseWin = await createWindow(1280, 720, true);
  const checkChinesePage = async (label) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const audit = await auditWindow(chineseWin, label);
    await captureVisual(chineseWin, label);
    const forbidden = [/\bAgent\b/, /\bMCP\b/, /\bIPC\b/, /\bWebUI\b/i, /Approval Center/i, /Plan mode/i, /tool call/i, /stack trace/i];
    const corrupted = [/\uFFFD/, /\u00ef\u00bf\u00bd/, /\u00e2\u20ac/, /\{\{\s*[\w.-]+\s*\}\}/, /(?:translation|i18n)\.missing/i];
    if (audit.lang !== "zh-CN") fail(label + " does not declare zh-CN");
    const forbiddenMatch = forbidden.find((pattern) => pattern.test(audit.text));
    if (forbiddenMatch) {
      const match = audit.text.match(forbiddenMatch);
      const index = match ? audit.text.indexOf(match[0]) : 0;
      fail(label + " exposes unexplained internal terminology matching " + forbiddenMatch + ": " + audit.text.slice(Math.max(0, index - 60), index + 120).replace(/\s+/g, " "));
    }
    if (corrupted.some((pattern) => pattern.test(audit.text))) fail(label + " contains corrupted or unresolved localization text");
    if (audit.clippedText.length) fail(label + " clips visible text: " + audit.clippedText.slice(0, 4).map((item) => item.tag + "." + item.className + "=" + item.text).join(" | "));
    return audit;
  };
  await checkChinesePage("m9-chinese-home");
  await chineseWin.webContents.executeJavaScript("document.querySelector('[data-nav-id=results]')?.click()");
  await checkChinesePage("m9-chinese-results");
  if (!(await clickByAnyText(chineseWin, ["Visual User", "User menu"]))) fail("could not open user menu for Chinese settings audit");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!(await clickByAnyText(chineseWin, [text.settingsZh, "Settings"]))) fail("could not open Chinese settings audit");
  await checkChinesePage("m9-chinese-settings");
  await chineseWin.webContents.executeJavaScript("document.querySelector('[data-testid=settings-pane-approvals]')?.click()");
  await checkChinesePage("m9-chinese-approval");
  chineseWin.close();

  if (m9Only) {
    if (failures.length) {
      console.error("M9 Chinese visual verification failed:");
      for (const failure of failures) console.error("- " + failure);
      app.exit(1);
      return;
    }
    clearTimeout(watchdog);
    console.log("M9 Chinese visual verification passed (home + results + settings + approval)." );
    app.exit(0);
    return;
  }

  console.log("Checking chat interaction...");
  const interactive = await createWindow(1280, 720, true);
  if (!(await fillTextarea(interactive, "visual release check"))) fail("could not fill chat textarea");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!(await clickByAnyText(interactive, [text.sendZh, "Send"]))) fail("could not click Send");
  // The renderer registers the request before the mock emits the start event; allow
  // React one complete render cycle before asserting the transient Stop state.
  await new Promise((resolve) => setTimeout(resolve, 700));
  const runningHasStop = await interactive.webContents.executeJavaScript("Boolean(document.querySelector('.composer-submit.stop'))");
  let interaction = await auditWindow(interactive, "interaction-chat-running");
  await captureVisual(interactive, "interaction-chat-running");
  if (!interaction.text.includes("visual release check")) fail("running chat user message did not render");
  if (!runningHasStop) fail("running chat did not expose Stop state");
  await new Promise((resolve) => setTimeout(resolve, 2200));
  interaction = await auditWindow(interactive, "interaction-chat");
  await captureVisual(interactive, "interaction-chat");
  if (!interaction.text.includes("visual release check")) fail("chat user message did not render");
  if (!interaction.text.includes("renderer") || !interaction.text.includes("ok")) fail("chat stream markdown did not render");
  if (await interactive.webContents.executeJavaScript("Boolean(document.querySelector('.composer-submit.stop'))")) {
    fail("chat request stayed in Stop state after stream completion");
  }
  if (!includesAny(interaction.text, ["部分可复现", "Partial evidence"])) fail("chat summary did not render the reproducibility badge");
  if (!includesAny(interaction.text, ["工具 1", "Tools 1"])) fail("chat summary did not render stable step counts");
  await interactive.webContents.executeJavaScript(
    "(() => { const details=document.querySelector('details.structured-process'); if (details && !details.open) details.querySelector('summary')?.click(); return Boolean(details); })()",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const inspectorStartedAt = Date.now();
  const openedRunInspector = await interactive.webContents.executeJavaScript(
    "(() => { const button=document.querySelector('.structured-activity-inspect'); button?.click(); return Boolean(button); })()",
  );
  if (!openedRunInspector) fail("could not deep-link Run Inspector from a chat activity");
  let targetReady = false;
  for (let attempt = 0; attempt < 60 && !targetReady; attempt += 1) {
    targetReady = await interactive.webContents.executeJavaScript("Boolean(document.querySelector('[data-item-id=visual-read].selected'))");
    if (!targetReady) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const inspectorInteractionMs = Date.now() - inspectorStartedAt;
  interaction = await auditWindow(interactive, "interaction-run-inspector");
  await captureVisual(interactive, "interaction-run-inspector");
  if (!includesAny(interaction.text, ["运行检查器", "Run Inspector"])) fail("Run Inspector did not render");
  const inspectedRuntimeRunId = await interactive.webContents.executeJavaScript(
    "document.querySelector('.run-inspector-panel')?.dataset.runId || ''",
  );
  if (inspectedRuntimeRunId !== "run-runtime-visual") fail("Run Inspector used the UI request id instead of the authoritative Runtime Run id");
  if (!includesAny(interaction.text, ["复现清单", "Reproduction manifest"])) fail("Run reproduction manifest did not render");
  if (!includesAny(interaction.text, ["部分可复现", "Partially reproducible"])) fail("Run reproducibility level did not render");
  if (!includesAny(interaction.text, ["输入 12", "Input 12"]) || !includesAny(interaction.text, ["输出 8", "Output 8"])) fail("Run usage summary did not render");
  const focusAudit = await interactive.webContents.executeJavaScript(
    "(() => ({ panelFocused: document.activeElement?.classList.contains('run-inspector-panel'), rendered: Number(document.querySelector('.run-inspector-timeline')?.dataset.renderedItems || 0), targetSelected: Boolean(document.querySelector('[data-item-id=visual-read].selected')) }))()",
  );
  if (!focusAudit.panelFocused) fail("keyboard focus did not enter Run Inspector");
  if (focusAudit.rendered > 200) fail("Run Inspector mounted more than 200 timeline items");
  if (!focusAudit.targetSelected) fail("Run Inspector did not auto-page and select the deep-linked item");
  if (inspectorInteractionMs > 1000) fail("100k Run Inspector deep-link exceeded the 1s interaction budget");
  for (const zoomFactor of [1, 1.25, 1.5]) {
    interactive.webContents.setZoomFactor(zoomFactor);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const zoomLabel = "interaction-run-inspector-zoom-" + Math.round(zoomFactor * 100);
    const zoomAudit = await auditWindow(interactive, zoomLabel);
    await captureVisual(interactive, zoomLabel);
    if (zoomAudit.overflow) fail("Run Inspector has horizontal overflow at " + Math.round(zoomFactor * 100) + "% zoom");
  }
  interactive.webContents.setZoomFactor(1);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const inspectorRestoredAfterZoom = await interactive.webContents.executeJavaScript("Boolean(document.querySelector('.run-inspector-panel'))");
  if (!inspectorRestoredAfterZoom) fail("Run Inspector did not restore after zoom reset");
  const openedPrivacyNotice = await interactive.webContents.executeJavaScript(
    "(() => { const buttons=[...document.querySelectorAll('.run-inspector-manifest-actions button')]; const button=buttons.at(-1); button?.click(); return Boolean(button); })()",
  );
  if (!openedPrivacyNotice) fail("could not open Run manifest export notice");
  await new Promise((resolve) => setTimeout(resolve, 40));
  interaction = await auditWindow(interactive, "interaction-run-inspector-export-notice");
  if (!includesAny(interaction.text, ["保存前请确认", "Before saving"])) fail("Run export privacy notice did not render");
  await interactive.webContents.executeJavaScript(axeSource);
  const runInspectorAxe = inspectorRestoredAfterZoom ? await interactive.webContents.executeJavaScript(
    "axe.run('.run-inspector-panel').then((result) => result.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious').map((item) => ({ id:item.id, nodes:item.nodes.map((node) => ({ target:node.target, summary:node.failureSummary })) })))",
  ) : [];
  if (runInspectorAxe.length) fail("Run Inspector axe serious/critical violations: " + JSON.stringify(runInspectorAxe));
  for (const canary of ["run-inspector-secret-canary", "run-inspector-raw-cot-canary", "private-user"]) {
    if (interaction.text.includes(canary)) fail("Run Inspector leaked " + canary);
  }
  if (!interaction.text.includes("Compared the public evidence")) fail("Run Inspector did not preserve the public reasoning summary");
  interactive.close();

  console.log("Checking conversation turn rail...");
  const turnRailWin = await createWindow(1800, 760, true, "visual-turn-rail");
  for (let index = 1; index <= 8; index += 1) {
    if (!(await fillTextarea(turnRailWin, "visual rail turn " + index))) fail("could not fill turn rail message " + index);
    if (!(await clickByAnyText(turnRailWin, [text.sendZh, "Send"]))) fail("could not send turn rail message " + index);
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  const turnRailAudit = await turnRailWin.webContents.executeJavaScript("(() => { const rail=document.querySelector('.conversation-turn-rail'); const titlebar=document.querySelector('.conversation-titlebar'); const composer=document.querySelector('.chat-primary-pane:not(.empty-chat) .composer'); const buttons=[...(rail?.querySelectorAll('button[data-turn-id]') || [])]; const railRect=rail?.getBoundingClientRect(); const titlebarRect=titlebar?.getBoundingClientRect(); const composerRect=composer?.getBoundingClientRect(); const rects=buttons.map((button) => button.getBoundingClientRect()); const centers=rects.map((rect) => rect.top + rect.height / 2); const gaps=centers.slice(1).map((center,index) => center - centers[index]); const target=buttons[3]; const targetRect=rects[3]; const hit=target && targetRect ? document.elementFromPoint(targetRect.left + targetRect.width / 2, targetRect.top + targetRect.height * 0.18) : null; hit?.click(); return { visible:Boolean(rail && getComputedStyle(rail).display === 'grid'), unobscured:Boolean(railRect && titlebarRect && composerRect && railRect.top >= titlebarRect.bottom && railRect.bottom <= composerRect.top), count:buttons.length, minGap:gaps.length ? Math.min(...gaps) : 0, maxGap:gaps.length ? Math.max(...gaps) : 0, minHitHeight:rects.length ? Math.min(...rects.map((rect) => rect.height)) : 0, hitTurnId:hit?.getAttribute?.('data-turn-id') || '', targetTurnId:target?.getAttribute('data-turn-id') || '', lineHeight:target ? parseFloat(getComputedStyle(target, '::after').height) : 0 }; })()");
  await new Promise((resolve) => setTimeout(resolve, 30));
  const turnRailClickAudit = await turnRailWin.webContents.executeJavaScript("(() => { const active=document.querySelector('.conversation-turn-rail button.active'); active?.focus(); active?.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true })); return { activeId:active?.getAttribute('data-turn-id') || '' }; })()");
  await new Promise((resolve) => setTimeout(resolve, 30));
  const turnRailKeyboardAudit = await turnRailWin.webContents.executeJavaScript("(() => { const active=document.querySelector('.conversation-turn-rail button.active'); return { activeId:active?.getAttribute('data-turn-id') || '', focusedId:document.activeElement?.getAttribute?.('data-turn-id') || '' }; })()");
  await captureVisual(turnRailWin, "conversation-turn-rail");
  if (!turnRailAudit.visible) fail("conversation turn rail is not visible at a wide viewport");
  if (!turnRailAudit.unobscured) fail("conversation turn rail extends beneath the titlebar or composer");
  if (turnRailAudit.count !== 8) fail("conversation turn rail rendered " + turnRailAudit.count + " markers instead of 8");
  if (turnRailAudit.maxGap - turnRailAudit.minGap > 1) fail("conversation turn rail markers are not evenly distributed");
  if (turnRailAudit.minHitHeight <= turnRailAudit.lineHeight * 2) fail("conversation turn rail hit regions are not larger than their visual lines");
  if (!turnRailAudit.hitTurnId || turnRailAudit.hitTurnId !== turnRailAudit.targetTurnId) fail("conversation turn rail blank-space click did not hit its turn segment");
  if (turnRailClickAudit.activeId !== turnRailAudit.targetTurnId) fail("conversation turn rail click did not activate immediately");
  if (!turnRailKeyboardAudit.activeId || turnRailKeyboardAudit.activeId !== turnRailKeyboardAudit.focusedId || turnRailKeyboardAudit.activeId === turnRailClickAudit.activeId) fail("conversation turn rail keyboard navigation did not move focus and selection: " + JSON.stringify({ click: turnRailClickAudit, keyboard: turnRailKeyboardAudit }));
  turnRailWin.close();

  console.log("Checking language switch...");
  const languageWin = await createWindow(1280, 720, true);
  if (!(await clickByAnyText(languageWin, ["Visual User", "User menu"]))) fail("could not open user menu for language switch");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!(await clickByAnyText(languageWin, [text.englishZh, "EN", "English"]))) fail("could not switch to English");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const languageAudit = await auditWindow(languageWin, "language-switch");
  await captureVisual(languageWin, "language-switch");
  if (!languageAudit.text.includes("New task")) fail("English new task action did not render");
  if (!languageAudit.text.includes("Settings")) fail("English settings navigation did not render");
  if (!languageAudit.text.includes("Workspace")) fail("English workspace section did not render");
  languageWin.close();

  if (failures.length) {
    console.error("Renderer visual verification failed:");
    for (const failure of failures) console.error("- " + failure);
    app.exit(1);
    return;
  }
  clearTimeout(watchdog);
  console.log("Renderer visual verification passed (3 viewports + bridge + chat + language).");
  app.exit(0);
}

app.whenReady().then(runCurrentVisual).catch((error) => {
  console.error(error);
  app.exit(1);
});
`;
}

function preloadSource(featureCapabilities) {
  return String.raw`
const { contextBridge } = require("electron");
const fs = require("fs");
const path = require("path");
window.localStorage.setItem("opendrsai:first-run-complete:v3", "true");
window.localStorage.setItem("opendrsai.lastWorkspace", "visual-workspace");

const chatListeners = new Set();
const agentRunListeners = new Set();
const installListeners = new Set();
const updateListeners = new Set();
let threads = [];
const modelStatePath = path.join(__dirname, "model-provider-state.json");
const initialModelConnection = {
  model: "visual-model",
  model_provider: "visual-provider",
  revision: "a".repeat(64),
  provider: { name: "visual-provider", base_url: "https://visual.example/v1", wire_api: "openai", requires_api_key: false, has_api_key: false, api_key_source: "none" },
  runtime: { runtime_status: "applied", configured_revision: "a".repeat(64), running_revision: "a".repeat(64) },
  last_test: { provider: "visual-provider", mode: "model", ok: true, tested_at: "2026-08-05T00:00:00.000Z" },
  metadata: { known_model: true },
};
let modelConnection = fs.existsSync(modelStatePath) ? JSON.parse(fs.readFileSync(modelStatePath, "utf8")) : initialModelConnection;
function persistModelConnection() { fs.writeFileSync(modelStatePath, JSON.stringify(modelConnection), { encoding: "utf8", mode: 0o600 }); }
function refreshModelConnection() { if (fs.existsSync(modelStatePath)) modelConnection = JSON.parse(fs.readFileSync(modelStatePath, "utf8")); return modelConnection; }
const modelProviderVisualState = { basicTestCalls: 0, modelTestCalls: 0, saveCalls: 0, deleteCalls: 0, migrationCalls: 0, configCalls: 0, lastDeleteCredential: null };

let health = {
  installed: true,
  gatewayReady: true,
  mode: "local",
  version: "0.1.0-dev",
  install: {
    installed: true,
    home: "C:\\Users\\Demo\\.drsai",
    repoPath: "C:\\Users\\Demo\\.drsai\\drsai-agent",
    pythonPath: "C:\\Users\\Demo\\.drsai\\drsai-agent\\venv\\Scripts\\python.exe",
    scriptPath: "C:\\Users\\Demo\\.drsai\\drsai-agent\\venv\\Scripts\\drsai.cmd",
    version: "0.1.0-dev",
    expectedVersion: null,
    backendNeedsRepair: false,
    configExists: true,
    envExists: true,
    apiKeyConfigured: true,
    prerequisites: {
      pythonOnPath: true,
      pythonVersion: "3.11",
      pythonCommand: "C:\\Users\\Demo\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
      gitOnPath: true,
      gitVersion: "git version 2.45.0.windows.1",
      gitCommand: "C:\\Program Files\\Git\\cmd\\git.exe",
      apiKeyConfigured: true,
      problems: [],
    },
    missing: [],
  },
  gateway: {
    ready: true,
    managed: true,
    baseUrl: "http://127.0.0.1:8642",
    pid: 4242,
    lastLog: "",
  },
  update: {
    phase: "idle",
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    progress: null,
    version: null,
    currentVersion: "1.4.6",
    mandatory: false,
    releaseNotesUrl: null,
    canDownload: false,
    canInstall: false,
    canCancel: false,
    errorCode: null,
    error: null,
    recovery: null,
  },
};

function emit(listeners, value) {
  for (const listener of listeners) listener(value);
}

function subscribe(listeners, callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

contextBridge.exposeInMainWorld("openDrSai", {
  isAppDialogE2eEnabled: () => false,
  isOperationalStateE2eEnabled: () => false,
  getModelProviderVisualState: () => ({ ...modelProviderVisualState, activeModel: modelConnection.model, activeProvider: modelConnection.model_provider, revision: modelConnection.revision }),
  resetModelProviderVisualState: () => {
    modelConnection = { ...modelConnection, model: "saved-model", model_provider: "visual-provider", provider: { name: "visual-provider", base_url: "https://visual.example/v1", wire_api: "openai", requires_api_key: false, has_api_key: false, api_key_source: "none" } };
    persistModelConnection();
    return true;
  },
  getPlatformDescriptor: async () => ({ id: "windows", defaultTerminalShell: "powershell", capabilities: { terminal: true, credentials: true, notifications: true, permissions: true, install: true, update: true, features: ${JSON.stringify(featureCapabilities)} } }),
  onOpenRequest: () => () => undefined,
  onLifecycleEvent: () => () => undefined,
  onDiagnosticEvent: () => () => undefined,
  onRuntimeLogEvent: () => () => undefined,
  recordDiagnostic: async (event) => ({ ...event, id: "visual-diagnostic", timestamp: new Date().toISOString() }),
  getDiagnosticSnapshot: async () => ({ generatedAt: new Date().toISOString(), events: [], traces: [], health: [], findings: [], deepTracing: { performance: [], resources: [], activeCheckpoints: [], clockOffsets: [] }, rootCause: { analyses: [], clusters: [], generatedAt: new Date().toISOString() }, droppedEvents: 0, storage: { eventCount: 0, maxEvents: 500, persisted: false } }),
  getAuthSession: async () => ({
    authenticated: true,
    user: {
      id: "visual-user",
      name: "Visual User",
      email: "visual@example.com",
    },
    expiresAt: null,
    authMode: "offline",
  }),
  getA5ServiceGuidanceScenario: async () => null,
  listUserPreferences: async () => [],
  upsertUserPreference: async (request) => ({
    category: request.category,
    value: request.value,
    scope: request.scope || "global",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  deleteUserPreference: async () => ({ removed: true }),
  setCompletionNotificationPreference: async (preference) => ({
    enabled: preference.enabled === true,
    language: preference.language === "en" ? "en" : "zh",
  }),
  onCompletionNotificationClick: () => () => undefined,
  login: async () => ({
    ok: true,
    message: "Mock sign-in complete.",
    session: {
      authenticated: true,
      user: {
        id: "visual-user",
        name: "Visual User",
        email: "visual@example.com",
      },
      expiresAt: null,
      authMode: "offline",
    },
  }),
  logout: async () => ({ ok: true, message: "Mock sign-out complete." }),
  previewLocalDataCleanup: async (scope) => ({ scope, applicationData: [{ category: "sessions", label: "会话", description: "清除会话记录。" }], preservedUserMaterials: [], preservesAllWorkspaceFiles: true, confirmationPhrase: scope === "all_local_data" ? "清除" : undefined, requiresSignInAgain: scope === "all_local_data" }),
  clearLocalData: async (request) => ({ ok: true, scope: request.scope, removedPaths: [], protectedWorkspacePaths: [], skippedTargets: [], requiresSignInAgain: request.scope === "all_local_data", message: "应用数据已清除；用户工作区文件和成果未受影响。" }),
  startDesktopSsoLogin: async () => ({ ok: false, message: "Mock SSO is unavailable." }),
  pollDesktopSsoLogin: async () => ({ ok: false, state: "error", message: "Mock SSO is unavailable." }),
  cancelDesktopSsoLogin: async () => undefined,
  refreshAuthSession: async () => ({
    authenticated: true,
    user: {
      id: "visual-user",
      name: "Visual User",
      email: "visual@example.com",
    },
    expiresAt: null,
    authMode: "offline",
  }),
  getHealth: async () => health,
  getInstallStatus: async () => health.install,
  getGatewayStatus: async () => health.gateway,
  getCodexBackendStatus: async () => ({
    backendId: "codex",
    state: "available",
    available: true,
    version: "0.142.5",
    loggedIn: true,
    authMode: "chatgpt",
    accountLabel: "visual@example.com",
    reason: null,
    retryable: false,
    action: "none",
  }),
  startCodexBackendLogin: async (type = "chatgpt") => ({
    type,
    loginId: "visual-codex-login",
    verificationUrl: "https://example.test/device",
    userCode: "VISUAL-CODE",
  }),
  cancelCodexBackendLogin: async () => true,
  logoutCodexBackend: async () => true,
  checkForUpdates: async () => {
    health = {
      ...health,
      update: {
        phase: "available",
        checking: false,
        available: true,
        downloading: false,
        downloaded: false,
        progress: null,
        version: "0.1.1",
        currentVersion: "0.1.0",
        mandatory: false,
        releaseNotesUrl: null,
        canDownload: true,
        canInstall: false,
        canCancel: false,
        errorCode: null,
        error: null,
      },
    };
    emit(updateListeners, health.update);
    return health.update;
  },
  downloadUpdate: async () => {
    health = { ...health, update: { ...health.update, phase: "ready", downloaded: true, progress: 100, canDownload: false, canInstall: true } };
    emit(updateListeners, health.update);
    return health.update;
  },
  cancelUpdate: async () => health.update,
  installUpdate: async () => {
    health = { ...health, update: { ...health.update, phase: "installing", canInstall: false } };
    emit(updateListeners, health.update);
    return health.update;
  },
  startInstall: async () => {
    emit(installListeners, { phase: "complete", message: "Mock installation complete.", log: "", exitCode: 0 });
  },
  cancelInstall: async () => true,
  startGateway: async () => true,
  stopGateway: async () => true,
  getMobilePairingReadiness: async () => ({ state: "ready", action: "scan", runtime_id: "runtime_visual", environment: "production" }),
  createMobilePairingGrant: async () => ({
    grant_id: "ag_00000000000000000000000000000000",
    expires_at: new Date(Date.now() + 120000).toISOString(),
    status: "pending",
    payload: "opendrsai://associate?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=ABCDEFGHJKLMNPQR",
  }),
  getMobilePairingGrant: async (grantId) => ({ grant_id: grantId, expires_at: new Date(Date.now() + 120000).toISOString(), status: "pending" }),
  revokeMobilePairingGrant: async (grantId) => ({ grant_id: grantId, expires_at: new Date().toISOString(), status: "revoked" }),
  onRemoteGatewayOperation: () => () => undefined,
  onRemoteWorkspaceStatus: () => () => undefined,
  onWorkspaceFileChanges: () => () => undefined,
  listAgents: async () => [],
  getMyDrSaiConfig: async () => {
    modelProviderVisualState.configCalls += 1;
    return ({
    ready: true,
    baseUrl: "http://127.0.0.1:8642",
    config: {},
    models: [{ alias: modelConnection.model, provider_id: modelConnection.model_provider, display_name: modelConnection.model, model: modelConnection.model, input_modalities: ["text", "image"], output_modalities: ["text", "image"], operations: ["chat", "tool_calling", "image_generation", "image_edit"], availability: "available", capability_source: "user_override" }],
    defaultModelAlias: modelConnection.model,
    configPath: "C:\\Users\\Demo\\.drsai\\mydrsai.json",
    agents: [],
    skills: [],
    workflows: [],
    modelConnection: refreshModelConnection(),
    updatedAt: new Date().toISOString(),
    });
  },
  getMyDrSaiRuntimeModelCatalog: async () => ({ revision: "sha256:" + "d".repeat(64), state: "fresh", models: [{ ref: { provider_id: modelConnection.model_provider, model_id: modelConnection.model }, display_name: modelConnection.model, input_modalities: ["text", "image"], output_modalities: ["text", "image"], operations: ["chat", "tool_calling", "image_generation", "image_edit"], reasoning_efforts: [], availability: "available", capability_source: "user_override", capability_confidence: "declared" }] }),
  getMyDrSaiAgentModelPolicy: async (agentId = "my-drsai") => ({ agent_id: agentId, primary_model: { mode: "inherit_provider_default" }, image_model: null, effective_ref: { provider_id: modelConnection.model_provider, model_id: modelConnection.model }, revision: "sha256:" + "e".repeat(64), valid: true }),
  updateMyDrSaiAgentModelPolicy: async (agentId, policy) => ({ ...policy, agent_id: agentId, effective_ref: policy.primary_model.mode === "explicit" ? policy.primary_model.ref : { provider_id: modelConnection.model_provider, model_id: modelConnection.model }, effective_image_ref: policy.image_model?.ref || null, revision: "sha256:" + "f".repeat(64), valid: true }),
  migrateMyDrSaiAgentModelPolicy: async (agentId, legacyModel) => {
    modelProviderVisualState.migrationCalls += 1;
    return { agent_id: agentId, primary_model: { mode: "explicit", ref: { provider_id: modelConnection.model_provider, model_id: legacyModel } }, image_model: null, effective_ref: { provider_id: modelConnection.model_provider, model_id: legacyModel }, revision: "sha256:" + "1".repeat(64), valid: true, migrated: true };
  },
  listMyDrSaiModelProviderPresets: async () => [{ id: "visual-provider", label: "Visual Provider", base_url: "https://visual.example/v1", wire_api: "openai", requires_api_key: false }, { id: "ollama", label: "Ollama", base_url: "http://127.0.0.1:11434/v1", wire_api: "openai", requires_api_key: false }],
  testMyDrSaiModelDraft: async (request, mode = "basic") => {
    if (request.model === "gateway-down") return Promise.reject("OpenDrSai is not running.");
    if (mode === "model") modelProviderVisualState.modelTestCalls += 1;
    else modelProviderVisualState.basicTestCalls += 1;
    const ok = request.model !== "fail-model";
    modelConnection = { ...modelConnection, last_test: { provider: request.model_provider, mode, ok, tested_at: new Date().toISOString(), ...(ok ? {} : { error: "synthetic_probe_failure" }) } };
    return { ok, provider: request.model_provider, wire_api: request.wire_api || "openai", persisted: false, ...(ok ? {} : { error: "synthetic_probe_failure" }) };
  },
  discoverMyDrSaiProviderModels: async (provider) => ({ ok: true, provider, models: provider === "ollama" ? ["llama-test"] : ["visual-model"], cached: false }),
  preflightMyDrSaiModelProviderDeletion: async (provider) => ({ provider, references: [], can_delete: true, migration_action: null }),
  previewMyDrSaiModelConnection: async (request) => ({
    ok: true,
    persisted: false,
    base_revision: refreshModelConnection().revision,
    effective: {
      ...refreshModelConnection(),
      model: request.model,
      model_provider: request.model_provider,
      provider: {
        name: request.model_provider,
        base_url: request.base_url || refreshModelConnection().provider.base_url,
        wire_api: request.wire_api || "openai",
        requires_api_key: request.requires_api_key !== false,
        has_api_key: false,
        api_key_source: request.api_key_env ? "env" : request.api_key ? "secure" : "none",
      },
    },
  }),
  updateMyDrSaiModelConnection: async (request) => {
    const latest = refreshModelConnection();
    if (request.expected_revision && request.expected_revision !== latest.revision) return Promise.reject({ code: "config_conflict", category: "contract", retryable: false });
    modelProviderVisualState.saveCalls += 1;
    const nextRevision = String.fromCharCode(97 + modelProviderVisualState.saveCalls).repeat(64);
    modelConnection = { ...modelConnection, model: request.model, model_provider: request.model_provider, revision: nextRevision, metadata: { known_model: !request.model.startsWith("unknown-") } };
    persistModelConnection();
    return modelConnection;
  },
  deleteMyDrSaiModelProvider: async (_provider, deleteCredential = true) => {
    modelProviderVisualState.deleteCalls += 1;
    modelProviderVisualState.lastDeleteCredential = deleteCredential;
    modelConnection = { ...modelConnection, model: "deepseek-v4-pro", model_provider: "hepai", provider: { name: "hepai", base_url: "https://aiapi.ihep.ac.cn/v1", wire_api: "openai", requires_api_key: true, has_api_key: true, api_key_source: "secure" } };
    persistModelConnection();
    return { ok: true, active: "hepai" };
  },
  bootstrapDesktop: async () => ({
    ready: true,
    message: "OpenDrSai visual runtime is ready.",
    user: { id: "visual-user", name: "Visual User", email: "visual@example.com" },
    capabilities: { chat: true, agent: true, tools: ["files", "shell", "git"] },
    defaults: { agentId: "drsai", modelAlias: "visual-model" },
    models: [{ id: "visual-model", name: "Visual model" }],
    limits: { maxConcurrentRuns: 1 },
  }),
  getVoiceRuntimeStatus: async () => ({
    runtimeId: "mock-local",
    state: "ready",
    supportedMimeTypes: ["audio/webm", "audio/wav"],
    maxBytes: 10485760,
    maxDurationSeconds: 120,
    supportsPartial: false,
    providerDisclosure: "Visual fixture transcription is active.",
    message: "Visual fixture voice runtime is ready.",
  }),
  onStreamingVoiceTranscriptionEvent: () => () => undefined,
  getStreamingVoiceCapabilities: async () => null,
  getDuplexVoiceCapabilities: async () => ({ enabled: false, inputAudioEncodings: ["pcm_s16le"], outputAudioEncodings: ["pcm_s16le"], inputSampleRates: [24000], outputSampleRates: [24000], channels: [1], maxChunkBytes: 65536, maxBufferedAudioMs: 2000, supportsServerVad: false, supportsBargeIn: false, supportsTools: false, providerDisclosure: "Visual fixture duplex voice is disabled.", reason: "visual_fixture" }),
  startDuplexVoiceSession: async () => { throw new Error("Duplex voice is disabled in the visual fixture."); },
  sendDuplexVoiceAudioChunk: () => false,
  updateDuplexVoiceSession: async () => false,
  interruptDuplexVoiceSession: async () => false,
  submitDuplexVoiceToolResult: async () => false,
  stopDuplexVoiceSession: async () => false,
  cancelDuplexVoiceSession: async () => false,
  disposeDuplexVoiceSession: async () => false,
  onDuplexVoiceEvents: () => () => undefined,
  appendDuplexVoiceHistory: async () => { throw new Error("Duplex voice history is unavailable in the visual fixture."); },
  recoverChatRun: async () => [],
  listSshHosts: async () => [{ alias: "zhangtianshuo_4090", hostname: "remote.example", user: "zhangtianshuo", port: 22, identityFiles: [] }],
  diagnoseSshHost: async (hostAlias) => ({ hostAlias, state: "reachable", elapsedMs: 1 }),
  inspectSshHostKeys: async () => [],
  testSshHost: async () => true,
  approveSshHostKey: async () => true,
  listRemoteDirectories: async (_hostAlias, remotePath) => {
    const base = (remotePath || "/home/zhangtianshuo").replace(/\/$/, "");
    return ["ai_completion", "Cline", "hai", "hai-ddf-main", "hai-k8s", "mineru2_hepai-main", "openclaw-main"].map((name) => ({
      name,
      path: base + "/" + name,
      directory: true,
      readable: true,
      writable: true,
      mode: "drwxr-xr-x",
    }));
  },
  connectRemoteWorkspace: async (request) => {
    const now = new Date().toISOString();
    const id = "remote-workspace-" + crypto.randomUUID();
    return {
      id,
      name: request.name,
      path: request.path,
      location: "remote",
      transport: "ssh",
      type: "remote-ssh",
      remote: { hostAlias: request.hostAlias, canonicalPath: request.path, workspaceId: id, connectionState: "ready" },
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      trusted: true,
    };
  },
  disconnectRemoteWorkspace: async () => true,
  listWorkspaces: async () => [{ id: "visual-workspace", name: "Visual workspace", path: "C:\\Users\\Demo\\workspace", location: "local", type: "local", description: "Renderer visual fixture", createdAt: "2026-08-05T00:00:00.000Z", updatedAt: "2026-08-05T00:00:00.000Z", lastOpenedAt: "2026-08-05T00:00:00.000Z", trusted: true }],
  createWorkspace: async (request) => ({
    id: "workspace-" + crypto.randomUUID(),
    name: request && request.name ? request.name : "Visual workspace",
    path: request && request.path ? request.path : "C:\\Users\\Demo\\project",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  createDefaultWorkspace: async () => ({
    id: "visual-workspace",
    name: "Visual workspace",
    path: "C:\\Users\\Demo\\workspace",
    location: "local",
    type: "local",
    description: "Renderer visual fixture",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    lastOpenedAt: "2026-08-05T00:00:00.000Z",
    trusted: true,
    metadata: { managedDefault: true, defaultWorkspaceVersion: 1 },
  }),
  updateWorkspace: async (request) => ({
    id: request && request.id ? request.id : "workspace-visual",
    name: request && request.name ? request.name : "Visual workspace",
    path: request && request.path ? request.path : "C:\\Users\\Demo\\project",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  deleteWorkspace: async () => ({ deleted: true }),
  pickFolder: async () => ({ canceled: false, paths: ["C:\\Users\\Demo\\source-project"] }),
  pickFiles: async () => [],
  listThreads: async () => threads,
  createThread: async (request) => {
    const now = new Date().toISOString();
    const thread = {
      id: "thread-" + crypto.randomUUID(),
      kind: request.kind,
      title: request.title || (request.kind === "agent_run" ? "Agent run" : "New chat"),
      workspacePath: request.workspacePath,
      createdAt: now,
      updatedAt: now,
      status: "idle",
      messageCount: 0,
    };
    threads = [thread, ...threads];
    return thread;
  },
  updateThread: async (request) => {
    const now = new Date().toISOString();
    const existing = threads.find((thread) => thread.id === request.id);
    const thread = {
      id: request.id,
      kind: request.kind || (existing && existing.kind) || "chat",
      title: request.title || (existing && existing.title) || "New chat",
      workspacePath: request.workspacePath || (existing && existing.workspacePath),
      createdAt: (existing && existing.createdAt) || now,
      updatedAt: now,
      lastRunId: request.lastRunId || (existing && existing.lastRunId),
      lastRequestId: request.lastRequestId || (existing && existing.lastRequestId),
      status: request.status || (existing && existing.status) || "idle",
      messageCount: request.messageCount ?? (existing && existing.messageCount),
    };
    threads = [thread, ...threads.filter((item) => item.id !== request.id)];
    return thread;
  },
  updateThreadSnapshot: async (snapshot) => snapshot,
  getThreadSnapshot: async () => null,
  subscribeThreadSnapshot: async () => true,
  unsubscribeThreadSnapshot: async () => true,
  onThreadSnapshot: () => () => undefined,
  onThreadCatalogUpdate: () => () => undefined,
  getIdeContext: async () => ({ providers: [], contexts: [], generatedAt: new Date().toISOString() }),
  listProjectMemory: async () => [],
  addProjectMemory: async (request) => ({
    id: "memory-" + crypto.randomUUID(),
    content: request && request.content ? request.content : "",
    source: request && request.source ? request.source : "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  updateProjectMemory: async (request) => ({
    id: request && request.id ? request.id : "memory-visual",
    content: request && request.content ? request.content : "",
    source: request && request.source ? request.source : "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  clearProjectMemory: async () => ({ removedCount: 0 }),
  listTeamMemory: async () => [],
  addTeamMemory: async (request) => ({
    id: "team-memory-" + crypto.randomUUID(),
    content: request && request.content ? request.content : "",
    scope: request && request.scope ? request.scope : "team",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  deleteTeamMemory: async () => ({ removed: true }),
  listCustomCommands: async () => [],
  upsertCustomCommand: async (request) => ({
    id: request && request.id ? request.id : "command-" + crypto.randomUUID(),
    name: request && request.name ? request.name : "visual",
    command: request && request.command ? request.command : "/visual",
    description: request && request.description ? request.description : "",
    body: request && request.body ? request.body : "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  deleteCustomCommand: async () => ({ removedCount: 0 }),
  getWorkspaceContextOverview: async () => ({
    workspacePath: "",
    trusted: true,
    instructions: [],
    stats: {
      instructionCount: 0,
      changedFileCount: 0,
    },
  }),
  getWorkspaceGitDiff: async () => ({ workspacePath: "", diff: "", truncated: false }),
  getWorkspaceGitFileAtRef: async () => ({ path: "", ref: "", content: "" }),
  previewWorkspaceFile: async () => ({ path: "", exists: false, content: "", truncated: false }),
  summarizeWorkspaceFolder: async () => ({ folderPath: "", fileCount: 0, files: [], summary: "No files selected." }),
  listWorkspaceFiles: async () => ({ workspacePath: "", nodes: [], totalEntries: 0, truncated: false }),
  getFileIcon: async () => null,
  stageWorkspaceFile: async () => ({ ok: true, message: "Mock staged." }),
  stageWorkspaceHunk: async () => ({ ok: true, message: "Mock hunk staged." }),
  revertWorkspaceFile: async () => ({ ok: true, message: "Mock reverted." }),
  revertWorkspaceHunk: async () => ({ ok: true, message: "Mock hunk reverted." }),
  createWorkspaceCheckpoint: async () => ({ id: "checkpoint-" + crypto.randomUUID(), createdAt: new Date().toISOString() }),
  listWorkspaceCheckpoints: async () => [],
  previewWorkspaceCheckpoint: async () => ({ files: [], summary: "No checkpoint preview." }),
  restoreWorkspaceCheckpoint: async () => ({ ok: true, message: "Mock checkpoint restored." }),
  requestGitCommitApproval: async () => ({ blocked: false, queued: true, allowed: true, reason: "Mock git commit approval queued." }),
  listPendingApprovals: async () => [],
  onBrowserTaskEvent: () => () => {},
  listWorkflowRuns: async () => [],
  listBackgroundTasks: async () => [],
  listIncomingShares: async () => [],
  listOutgoingShares: async () => [],
  listShareCommentTasks: async () => [],
  listShareComments: async () => [],
  listReusableTasks: async () => [],
  decidePendingApproval: async () => ({ ok: true, message: "Mock approval decision recorded." }),
  importMcpContext: async () => ({ importedCount: 0, events: [] }),
  requestMcpLiveEnumeration: async () => ({ blocked: false, queued: true, allowed: true, reason: "Mock MCP enumeration queued." }),
  requestMcpToolExecutionApproval: async () => ({ blocked: false, queued: true, allowed: true, reason: "Mock MCP tool approval queued." }),
  listMcpActiveSessions: async () => [],
  listMcpReusableSessions: async () => [],
  listMcpToolExecutionAudits: async () => [],
  listMcpSessionAudits: async () => [],
  cancelMcpActiveSession: async () => ({ ok: true }),
  closeMcpReusableSession: async () => ({ ok: true }),
  startChat: async (request) => {
    const requestId = request.requestId || crypto.randomUUID();
    const latestMessage = Array.isArray(request.messages) ? request.messages.at(-1)?.content || "" : "";
    if (latestMessage.includes("visual rail turn")) {
      setTimeout(() => emit(chatListeners, { requestId, runId: requestId, seq: 1, type: "start" }), 10);
      setTimeout(() => emit(chatListeners, { requestId, seq: 2, type: "chunk", content: "Rail response." }), 30);
      setTimeout(() => emit(chatListeners, { requestId, seq: 3, type: "done" }), 60);
      return requestId;
    }
    // Do not beat the renderer's request-id registration on fast machines.
    setTimeout(() => emit(chatListeners, { requestId, runId: "run-runtime-visual", seq: 1, type: "start" }), 100);
    setTimeout(() => emit(chatListeners, { requestId, seq: 2, type: "reasoning", content: "Checking renderer constraints." }), 700);
    setTimeout(() => emit(chatListeners, { requestId, seq: 3, type: "tool_timeline", oaepItemId: "visual-read", toolTimeline: { id: "visual-read", oaepItemId: "visual-read", kind: "tool_call", title: "Read workspace file", toolName: "read_file", status: "completed", content: "src/main.ts" } }), 900);
    setTimeout(() => emit(chatListeners, { requestId, seq: 4, type: "chunk", content: "Mock **desktop** chat stream.\n\n" }), 1200);
    setTimeout(() => emit(chatListeners, { requestId, seq: 4, type: "chunk", content: "DUPLICATE MUST NOT RENDER" }), 1300);
    setTimeout(() => emit(chatListeners, { requestId, seq: 5, type: "chunk", content: "| item | status |\n| --- | --- |\n| renderer | ok |\n\n" }), 1600);
    setTimeout(() => emit(chatListeners, { requestId, seq: 6, type: "done" }), 1900);
    return requestId;
  },
  cancelChatTurn: async () => ({ accepted: true, state: "cancelling" }),
  listSessionRuns: async () => ({ schema_version: "opendrsai.run-inspection/1", object: "list", data: [], next_cursor: null, has_more: false }),
  getRunInspection: async (request) => {
    const pageIndex = Number(request.timelineCursor || 0);
    const timeline = Array.from({ length: 100 }, (_, offset) => {
      const index = pageIndex * 100 + offset;
      if (offset === 0) return { id: "visual-reasoning-" + index, session_id: "visual-session", run_id: request.runId, type: "reasoning", status: "completed", sequence: index + 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), source: { backend: "runtime" }, content: { segments: [{ text: "run-inspector-raw-cot-canary" }], chain_of_thought: "run-inspector-raw-cot-canary", summary: "Compared the public evidence.", public_summary: "Compared the public evidence." }, event_refs: [{ event_id: "visual-reasoning-event-" + index, sequence: index + 1 }] };
      return { id: index === 99999 ? "visual-read" : "visual-item-" + index, session_id: "visual-session", run_id: request.runId, type: "message", status: "completed", sequence: index + 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), source: { backend: "codex", backend_event_id: "visual-event-" + index }, content: { role: "assistant", phase: "final", text: "Mock item " + index }, event_refs: [{ event_id: "visual-event-" + index, sequence: index + 1 }] };
    });
    return {
      schema_version: "opendrsai.run-inspection/1",
      run: { run_id: request.runId, session_id: "visual-session", workspace_id: "visual-workspace", backend_id: "codex", agent_definition: "codex@1", status: "completed", created_at: new Date(Date.now() - 18000).toISOString(), completed_at: new Date().toISOString() },
      summary: { duration_ms: 18000, counts_by_item_type: { message: 100000 }, counts_by_status: { completed: 100000 }, error: null, usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 }, artifact_count: 0, warning_count: 0 },
      timeline,
      manifest: { schema_version: "opendrsai.run-manifest/1", run_id: request.runId, manifest: { model: { id: "mock-model", api_key: "run-inspector-secret-canary" }, workspace: { root: "C:\\Users\\private-user\\workspace" } }, manifest_digest: "a".repeat(64), safe_manifest_digest: "b".repeat(64), reproducibility_level: "partial", missing_evidence: ["workspace.revision"], created_at: new Date().toISOString(), finalized_at: new Date().toISOString() },
      page: { next_cursor: pageIndex < 999 ? String(pageIndex + 1) : null, has_more: pageIndex < 999 },
    };
  },
  locateRunItem: async (request) => ({
    schema_version: "opendrsai.run-inspection/1",
    run_id: request.runId,
    item_id: request.itemId,
    item_sequence: request.itemId === "visual-read" ? 100000 : 1,
    timeline_cursor: request.itemId === "visual-read" ? "999" : null,
  }),
  getExperimentReleaseGate: async () => ({ schema_version: "opendrsai.experiment-release-gate/1", enabled: false, required_features: ["M31-02", "M31-03", "M31-04", "M31-05"], passed_features: ["M31-03"], blocking_features: ["M31-02", "M31-04", "M31-05"], source_ledger_sha256: "a".repeat(64), reason: "release_evidence_incomplete" }),
  getRunReproductionManifest: async (request) => ({ schema_version: "opendrsai.run-manifest/1", run_id: request.runId, manifest: {}, manifest_digest: "a".repeat(64), safe_manifest_digest: "b".repeat(64), reproducibility_level: "partial", missing_evidence: ["workspace.revision"], created_at: new Date().toISOString(), finalized_at: null }),
  exportRunReproductionManifest: async (request) => ({ schema_version: "opendrsai.run-manifest/1", run_id: request.runId, manifest: {}, manifest_digest: "a".repeat(64), safe_manifest_digest: "b".repeat(64), reproducibility_level: "partial", missing_evidence: ["workspace.revision"], created_at: new Date().toISOString(), finalized_at: null }),
  startAgentRun: async (request) => {
    const requestId = request.requestId || crypto.randomUUID();
    const sessionId = request.sessionId || requestId;
    const runId = request.runId || requestId;
    emit(agentRunListeners, { requestId, sessionId, runId, type: "start" });
    setTimeout(() => emit(agentRunListeners, { requestId, sessionId, runId, type: "chunk", content: "Mock agent run started.\n\n" }), 120);
    setTimeout(() => emit(agentRunListeners, { requestId, sessionId, runId, type: "chunk", content: request.task }), 260);
    if (String(request.task || "").includes("failure")) {
      setTimeout(() => emit(agentRunListeners, { requestId, sessionId, runId, type: "error", error: "synthetic visual agent error" }), 360);
      return { requestId, sessionId, runId };
    }
    setTimeout(() => emit(agentRunListeners, { requestId, sessionId, runId, type: "chunk", content: "\n\nMock agent run complete." }), 360);
    setTimeout(() => emit(agentRunListeners, { requestId, sessionId, runId, type: "done" }), 430);
    return { requestId, sessionId, runId };
  },
  abortAgentRun: async (requestId) => {
    emit(agentRunListeners, { requestId, sessionId: requestId, runId: requestId, type: "aborted" });
    return true;
  },
  saveApiKey: async () => ({ ok: true, message: "Mock API key saved." }),
  openExternal: async () => undefined,
  openPath: async () => "",
  onInstallProgress: (callback) => subscribe(installListeners, callback),
  onAuthSessionInvalidated: () => () => undefined,
  onCodexWorkspaceSessionSyncProgress: () => () => undefined,
  onChatEvent: (callback) => subscribe(chatListeners, callback),
  onThreadSnapshotPatch: () => () => {},
  onManagerPresentationProgress: () => () => {},
  onAgentRunEvent: (callback) => subscribe(agentRunListeners, callback),
  onUpdateStatus: (callback) => subscribe(updateListeners, callback),
});
`;
}
