import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererHtml = join(root, "out", "renderer", "index.html");
const artifactDir =
  process.env.OPENDRSAI_VISUAL_ARTIFACT_DIR ||
  join(root, "release", "visual-checks");

if (!existsSync(rendererHtml)) {
  throw new Error("Build the renderer before running verify:visual.");
}

const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-visual-"));
const mainPath = join(tempDir, "main.cjs");
const preloadPath = join(tempDir, "preload.cjs");

writeFileSync(preloadPath, preloadSource(), "utf8");
mkdirSync(artifactDir, { recursive: true });
writeFileSync(mainPath, mainSource({ root, rendererHtml, preloadPath, artifactDir }), "utf8");

try {
  await runElectron(mainPath);
} finally {
  cleanupTempDir(tempDir);
}

function cleanupTempDir(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    console.warn(`Could not remove temporary directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runElectron(scriptPath) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [join(root, "node_modules", "electron", "cli.js"), scriptPath], {
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

function mainSource({ rendererHtml: htmlPath, preloadPath: preload, artifactDir: screenshots }) {
  return String.raw`
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const rendererHtml = ${JSON.stringify(htmlPath)};
const preloadPath = ${JSON.stringify(preload)};
const artifactDir = ${JSON.stringify(screenshots)};
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

async function createWindow(width, height, withBridge = true) {
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
    },
  });
  await withTimeout(win.loadFile(rendererHtml), "load renderer");
  await withTimeout(
    win.webContents.executeJavaScript("document.fonts && document.fonts.ready ? document.fonts.ready : undefined"),
    "wait for fonts",
  );
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
    return {
      label: ${"${"}JSON.stringify(label)},
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: html.scrollWidth,
      clientWidth: html.clientWidth,
      overflow: html.scrollWidth > html.clientWidth + 1,
      text,
      buttons,
      offscreen,
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
  if (!languageAudit.buttons.some((button) => button.text === "New chat" || button.text === "Settings")) fail("English navigation did not render");
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
    newChatZh: "\u5f00\u59cb\u804a\u5929",
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
    if (!includesAny(audit.text, [text.newChatZh, "New chat"])) fail(audit.label + " is missing new chat action");
    if (!includesAny(audit.text, [text.searchZh, "Search"])) fail(audit.label + " is missing search action");
    if (!includesAny(audit.text, [text.workspaceZh, "Workspace"])) fail(audit.label + " is missing workspace section");
    if (!audit.hasTextarea) fail(audit.label + " is missing chat textarea");
    const accessibleNav = audit.buttons.filter((button) =>
      [text.newChatZh, text.searchZh, text.scheduledZh, text.agentsZh, text.skillsZh, text.settingsZh, "New chat", "Search", "Scheduled", "Agents", "Skills", "Settings"].includes(
        button.text,
      ),
    );
    if (accessibleNav.some((button) => !button.title || !button.aria)) fail(audit.label + " has inaccessible nav buttons");
    win.close();
  }

  console.log("Checking chat interaction...");
  const interactive = await createWindow(1280, 720, true);
  if (!(await fillTextarea(interactive, "visual release check"))) fail("could not fill chat textarea");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!(await clickByAnyText(interactive, [text.sendZh, "Send"]))) fail("could not click Send");
  await new Promise((resolve) => setTimeout(resolve, 250));
  let interaction = await auditWindow(interactive, "interaction-chat-running");
  await captureVisual(interactive, "interaction-chat-running");
  if (!interaction.text.includes("visual release check")) fail("running chat user message did not render");
  if (!interaction.buttons.some((button) => [text.stopZh, "Stop"].includes(button.text))) fail("running chat did not expose Stop state");
  await new Promise((resolve) => setTimeout(resolve, 2200));
  interaction = await auditWindow(interactive, "interaction-chat");
  await captureVisual(interactive, "interaction-chat");
  if (!interaction.text.includes("visual release check")) fail("chat user message did not render");
  if (!interaction.text.includes("renderer") || !interaction.text.includes("ok")) fail("chat stream markdown did not render");
  if (interaction.buttons.some((button) => [text.stopZh, "Stop"].includes(button.text))) {
    fail("chat request stayed in Stop state after stream completion");
  }
  interactive.close();

  console.log("Checking language switch...");
  const languageWin = await createWindow(1280, 720, true);
  if (!(await clickByAnyText(languageWin, ["Visual User", "User menu"]))) fail("could not open user menu for language switch");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!(await clickByAnyText(languageWin, [text.englishZh, "EN", "English"]))) fail("could not switch to English");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const languageAudit = await auditWindow(languageWin, "language-switch");
  await captureVisual(languageWin, "language-switch");
  if (!languageAudit.text.includes("New chat")) fail("English new chat action did not render");
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

function preloadSource() {
  return String.raw`
const { contextBridge } = require("electron");

const chatListeners = new Set();
const agentRunListeners = new Set();
const installListeners = new Set();
const updateListeners = new Set();
let threads = [];

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
    currentVersion: "1.4.2",
    mandatory: false,
    releaseNotesUrl: null,
    canDownload: false,
    canInstall: false,
    canCancel: false,
    errorCode: null,
    error: null,
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
  listAgents: async () => [],
  getMyDrSaiConfig: async () => ({
    configPath: "C:\\Users\\Demo\\.drsai\\mydrsai.json",
    agents: [],
    skills: [],
    workflows: [],
    updatedAt: new Date().toISOString(),
  }),
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
  listWorkspaces: async () => [],
  createWorkspace: async (request) => ({
    id: "workspace-" + crypto.randomUUID(),
    name: request && request.name ? request.name : "Visual workspace",
    path: request && request.path ? request.path : "C:\\Users\\Demo\\project",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  updateWorkspace: async (request) => ({
    id: request && request.id ? request.id : "workspace-visual",
    name: request && request.name ? request.name : "Visual workspace",
    path: request && request.path ? request.path : "C:\\Users\\Demo\\project",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  deleteWorkspace: async () => ({ deleted: true }),
  pickFolder: async () => null,
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
    emit(chatListeners, { requestId, seq: 1, type: "start" });
    setTimeout(() => emit(chatListeners, { requestId, seq: 2, type: "reasoning", content: "Checking renderer constraints." }), 700);
    setTimeout(() => emit(chatListeners, { requestId, seq: 3, type: "tool_timeline", toolTimeline: { id: "visual-read", kind: "tool_call", title: "Read workspace file", toolName: "read_file", status: "completed", content: "src/main.ts" } }), 900);
    setTimeout(() => emit(chatListeners, { requestId, seq: 4, type: "chunk", content: "Mock **desktop** chat stream.\n\n" }), 1200);
    setTimeout(() => emit(chatListeners, { requestId, seq: 4, type: "chunk", content: "DUPLICATE MUST NOT RENDER" }), 1300);
    setTimeout(() => emit(chatListeners, { requestId, seq: 5, type: "chunk", content: "| item | status |\n| --- | --- |\n| renderer | ok |\n\n" }), 1600);
    setTimeout(() => emit(chatListeners, { requestId, seq: 6, type: "done" }), 1900);
    return requestId;
  },
  abortChat: async () => true,
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
  onChatEvent: (callback) => subscribe(chatListeners, callback),
  onAgentRunEvent: (callback) => subscribe(agentRunListeners, callback),
  onUpdateStatus: (callback) => subscribe(updateListeners, callback),
});
`;
}
