import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Sleep/wake acceptance requires Apple Silicon macOS hardware.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let releaseMount;
let appBundle = resolve(process.env.OPENDRSAI_MACOS_APP_PATH || join(root, "release", "mac-arm64", "OpenDrSai.app"));
if (!process.env.OPENDRSAI_MACOS_APP_PATH && !hasRuntimeArchive(appBundle)) {
  const dmg = join(root, "release", "OpenDrSai-macOS-v1.5.7-arm64.dmg");
  assert.ok(existsSync(dmg), `Sleep/wake full Runtime DMG is missing: ${dmg}`);
  releaseMount = mkdtempSync(join(tmpdir(), "opendrsai-macos-sleep-wake-dmg-"));
  const attached = spawnSync("/usr/bin/hdiutil", ["attach", dmg, "-readonly", "-nobrowse", "-mountpoint", releaseMount], { encoding: "utf8" });
  assert.equal(attached.status, 0, `Could not mount ${dmg}.\n${attached.stderr}`);
  appBundle = join(releaseMount, "OpenDrSai.app");
}
process.once("exit", cleanupReleaseMount);
const executable = join(appBundle, "Contents", "MacOS", "OpenDrSai");
const signature = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appBundle], { encoding: "utf8" });
assert.equal(signature.status, 0, `Sleep/wake acceptance requires a sealed App bundle.\n${signature.stderr}`);

// Keep the isolated Runtime below Python's executable-path limit. macOS's
// per-user TMPDIR plus the transactional install UUID can exceed that limit.
const rounds = boundedInteger(process.env.OPENDRSAI_MACOS_SLEEP_WAKE_ROUNDS, 20, 1, 20);
const automatic = process.argv.includes("--auto") || process.env.OPENDRSAI_MACOS_SLEEP_WAKE_AUTO === "1";
if (automatic) {
  const sudo = spawnSync("/usr/bin/sudo", ["-n", "true"], { encoding: "utf8" });
  assert.equal(sudo.status, 0, "Automatic sleep/wake requires a current sudo credential. Run `sudo -v` in a visible terminal immediately before this command.");
}
const temp = mkdtempSync("/private/tmp/odsw-");
const home = join(temp, "home");
const sentinel = join(temp, "user-data-sentinel.txt");
await import("node:fs/promises").then(({ writeFile }) => writeFile(sentinel, "sleep-wake-user-data\n", { encoding: "utf8", mode: 0o600 }));
const sentinelBefore = sha256(sentinel);
const roundResults = [];
const allObservedPids = new Set();
let accepted = false;

try {
  for (let round = 1; round <= rounds; round += 1) roundResults.push(await runRound(round));
  assert.equal(sha256(sentinel), sentinelBefore, "Sleep/wake changed the user-data sentinel.");
  const receipt = {
    schemaVersion: 2,
    testId: "sleep-wake-real-device",
    platform: "darwin-arm64",
    featureIds: ["F06.4", "F06.5", "F08.5", "F10.3"],
    hardware: "Apple Silicon",
    passed: true,
    roundsRequired: 20,
    roundsCompleted: roundResults.length,
    formalTwentyRoundRequirementSatisfied: roundResults.length === 20,
    automatic,
    userDataSha256Before: sentinelBefore,
    userDataSha256After: sha256(sentinel),
    userDataPreserved: true,
    rounds: roundResults,
    observedProcessCount: allObservedPids.size,
    residualProcessCount: 0,
    generatedAt: new Date().toISOString(),
  };
  assert.equal(receipt.formalTwentyRoundRequirementSatisfied, rounds === 20, "A non-20-round diagnostic run cannot satisfy the formal release gate.");
  const acceptancePath = join(root, "build", "acceptance", "sleep-wake-real-device.json");
  await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(dirname(acceptancePath), { recursive: true }).then(() => writeFile(acceptancePath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8")));
  accepted = true;
  console.log(`macOS real-device sleep/wake acceptance passed (${roundResults.length} rounds).`);
} finally {
  if (accepted) rmSync(temp, { recursive: true, force: true });
  else console.error(`Sleep/wake acceptance preserved failed fixture at ${temp}`);
  cleanupReleaseMount();
}

async function runRound(round) {
const resultPath = join(temp, `result-${round}.json`);
const readyPath = join(temp, `ready-${round}.json`);
const gatewayPort = await freePort();
const child = spawn(executable, [], {
  env: {
    ...process.env,
    DRSAI_HOME: home,
    DRSAI_API_PORT: String(gatewayPort),
    OPENDRSAI_RUNTIME_PERSIST: "0",
    OPENDRSAI_DEV_AUTH_BYPASS: "1",
    OPENDRSAI_E2E_AUTH_USER_ID: "sleep-wake-device-user",
    OPENDRSAI_PLATFORM_AGENTS_ENABLED: "0",
    OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: resultPath,
    OPENDRSAI_MACOS_PACKAGED_SCENARIO: "sleep-wake",
    OPENDRSAI_MACOS_PACKAGED_SCENARIO_CONFIG: JSON.stringify({ readyPath, durationMs: 900_000 }),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
let stdout = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
const observedPids = new Set(child.pid ? [child.pid] : []);
const sampler = setInterval(() => observeProcessTree(child.pid, observedPids), 1_000);
try {
  const ready = await waitForJson(readyPath, 300_000, child, resultPath, () => stdout, () => stderr);
  assert.equal(ready.ready, true);
  console.log(`READY ${round}/${rounds}: OpenDrSai PID ${ready.appPid}, Gateway PID ${ready.gatewayBefore.pid}.`);
  if (automatic) scheduleAutomaticWakeAndSleep();
  else console.log("Put this Mac to sleep, then wake and unlock it within 15 minutes.");
  const result = await waitForJson(resultPath, 960_000, child, resultPath, () => stdout, () => stderr);
  assert.equal(result.ok, true, result.error ?? stderr);
  assert.equal(result.allExpectedEventsObserved, true);
  assert.equal(result.eventOrderValid, true);
  assert.equal(result.gatewayAfter.ready, true);
  const exit = await waitForExit(child, 30_000);
  assert.equal(exit, 0, stderr);
  clearInterval(sampler);
  const residualPids = await waitForNoResiduals(observedPids, 5_000);
  assert.deepEqual(residualPids, [], `Sleep/wake App tree left residual processes: ${residualPids.join(", ")}`);
  for (const pid of observedPids) allObservedPids.add(pid);
  console.log(`macOS real-device sleep/wake round ${round}/${rounds} passed (${result.events.length} native lifecycle events).`);
  return { round, ...result, observedProcessCount: observedPids.size, residualProcessCount: 0 };
} finally {
  clearInterval(sampler);
  if (child.exitCode === null) child.kill("SIGTERM");
}
}

function scheduleAutomaticWakeAndSleep() {
  const wake = new Date(Date.now() + 90_000);
  const stamp = `${pad(wake.getMonth() + 1)}/${pad(wake.getDate())}/${String(wake.getFullYear()).slice(-2)} ${pad(wake.getHours())}:${pad(wake.getMinutes())}:${pad(wake.getSeconds())}`;
  runSudoPmset(["schedule", "wakeorpoweron", stamp]);
  runSudoPmset(["sleepnow"]);
}

function runSudoPmset(args) {
  const result = spawnSync("/usr/bin/sudo", ["-n", "/usr/bin/pmset", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `pmset ${args[0]} failed: ${result.stderr}`);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = value === undefined ? fallback : Number(value);
  assert.ok(Number.isInteger(parsed) && parsed >= min && parsed <= max, `Expected integer ${min}..${max}; received ${value}`);
  return parsed;
}

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function pad(value) { return String(value).padStart(2, "0"); }

function hasRuntimeArchive(candidateApp) {
  try {
    const runtime = join(candidateApp, "Contents", "Resources", "runtime");
    const manifest = JSON.parse(readFileSync(join(runtime, "runtime-manifest.json"), "utf8"));
    return typeof manifest.archive === "string" && existsSync(join(runtime, manifest.archive));
  } catch { return false; }
}

function cleanupReleaseMount() {
  if (!releaseMount) return;
  spawnSync("/usr/bin/hdiutil", ["detach", releaseMount, "-force"], { stdio: "ignore" });
  rmSync(releaseMount, { recursive: true, force: true });
  releaseMount = undefined;
}

function observeProcessTree(rootPid, observed) {
  if (!rootPid) return;
  const snapshot = spawnSync("/bin/ps", ["-axo", "pid=,ppid="], { encoding: "utf8" });
  if (snapshot.status !== 0) throw new Error(`Could not sample packaged process tree: ${snapshot.stderr}`);
  const children = new Map();
  for (const line of snapshot.stdout.split("\n")) {
    const [pidText, ppidText] = line.trim().split(/\s+/);
    const pid = Number(pidText); const ppid = Number(ppidText);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const values = children.get(ppid) ?? [];
    values.push(pid); children.set(ppid, values);
  }
  const queue = [rootPid];
  const visited = new Set();
  while (queue.length) {
    const pid = queue.shift();
    if (!pid || visited.has(pid)) continue;
    visited.add(pid);
    observed.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
}

async function waitForNoResiduals(observed, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let alive = [...observed].filter(isAlive);
  while (alive.length && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    alive = [...observed].filter(isAlive);
  }
  return alive;
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

async function waitForJson(path, timeoutMs, child, resultPath, stdout, stderr) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch {}
    if (child.exitCode !== null) {
      let scenario = "";
      try { scenario = `\nScenario result:\n${readFileSync(resultPath, "utf8")}`; } catch {}
      throw new Error(`OpenDrSai exited before writing ${path}.${scenario}\nstdout:\n${stdout()}\nstderr:\n${stderr()}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${path}.\n${stderr()}`);
}

function waitForExit(process, timeoutMs) {
  if (process.exitCode !== null) return Promise.resolve(process.exitCode);
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for OpenDrSai to exit.")), timeoutMs);
    process.once("exit", (code) => { clearTimeout(timer); resolveExit(code); });
  });
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : port ? resolvePort(port) : reject(new Error("Could not reserve a Gateway port.")));
    });
  });
}
