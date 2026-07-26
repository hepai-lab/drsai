import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("TCC L6 must run on a real Apple Silicon Mac.");
assert.equal(process.env.OPENDRSAI_MACOS_TCC_REAL_DEVICE, "1", "Set OPENDRSAI_MACOS_TCC_REAL_DEVICE=1 only while operating the physical acceptance Mac.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "release", "mac-arm64", "OpenDrSai.app");
const executable = join(app, "Contents", "MacOS", "OpenDrSai");
assert.ok(existsSync(executable), "signed release candidate App is missing");
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
const temp = mkdtempSync(join(tmpdir(), "opendrsai-tcc-l6-"));
const resultPath = join(temp, "tcc.json");
try {
  const child = spawn(executable, [], {
    env: { ...process.env, DRSAI_HOME: join(temp, "home"), OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: resultPath, OPENDRSAI_MACOS_PACKAGED_SCENARIO: "tcc", OPENDRSAI_UPDATE_HEALTH_DELAY_MS: "1000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const result = await waitForJson(resultPath, child, 600_000, () => stderr);
  const exit = await waitForExit(child, 30_000);
  assert.equal(exit, 0, stderr);
  assert.equal(result.ok, true);
  assert.ok(["granted", "denied", "restricted"].includes(result.microphone.state), `microphone TCC remained unresolved: ${result.microphone.state}`);
  assert.ok(["granted", "denied"].includes(result.automation.state), `Automation TCC remained unresolved: ${result.automation.state}`);
  assert.equal(result.notifications.canRequest, true);
  assert.equal(result.filesSettingsOpened, true);
  const operator = run("/usr/bin/osascript", ["-e", 'display dialog "Did the OpenDrSai notification appear, and did macOS open the Files/Full Disk Access settings pane?" buttons {"Reject", "Confirmed"} default button "Confirmed" cancel button "Reject" giving up after 600']);
  assert.match(operator, /button returned:Confirmed/);
  const machine = machineEvidence();
  const acceptance = join(root, "build", "acceptance");
  mkdirSync(acceptance, { recursive: true });
  writeFileSync(join(acceptance, "tcc-real-device.json"), `${JSON.stringify({
    schemaVersion: 2,
    testId: "tcc-real-device",
    platform: "darwin-arm64",
    passed: true,
    featureIds: ["F05.5", "F11.6"],
    appExecutableSha256: sha256(executable),
    microphoneState: result.microphone.state,
    automationState: result.automation.state,
    notificationVisiblyConfirmed: true,
    filesSettingsOpened: true,
    osVersion: machine.osVersion,
    osBuild: machine.osBuild,
    hardwareModel: machine.hardwareModel,
    hardwareIdentitySha256: machine.hardwareIdentitySha256,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  console.log(`macOS real-device TCC passed: microphone=${result.microphone.state}, automation=${result.automation.state}.`);
} finally { rmSync(temp, { recursive: true, force: true }); }

function machineEvidence() {
  const osVersion = run("/usr/bin/sw_vers", ["-productVersion"]).trim();
  const osBuild = run("/usr/bin/sw_vers", ["-buildVersion"]).trim();
  const hardwareModel = run("/usr/sbin/sysctl", ["-n", "hw.model"]).trim();
  const identity = run("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
  const match = identity.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
  assert.ok(match, "physical Mac hardware identity is unavailable");
  return { osVersion, osBuild, hardwareModel, hardwareIdentitySha256: createHash("sha256").update(match[1]).digest("hex") };
}
function run(command, args) { const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000 }); if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message}`); return `${result.stdout || ""}\n${result.stderr || ""}`; }
function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function waitForExit(child, timeout) { if (child.exitCode !== null) return Promise.resolve(child.exitCode); return new Promise((resolveExit, reject) => { const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("TCC App did not exit")); }, timeout); child.once("exit", (code) => { clearTimeout(timer); resolveExit(code); }); }); }
async function waitForJson(path, child, timeout, stderr) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { /* wait for operator */ } if (child.exitCode !== null) throw new Error(`TCC App exited before result (${child.exitCode})\n${stderr()}`); await new Promise((resolveDelay) => setTimeout(resolveDelay, 200)); } child.kill("SIGKILL"); throw new Error(`TCC interaction timed out\n${stderr()}`); }
