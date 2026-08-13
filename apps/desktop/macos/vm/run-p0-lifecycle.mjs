#!/usr/bin/env node

import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const vmDir = dirname(fileURLToPath(import.meta.url));
const macosRoot = resolve(vmDir, "..");
const config = JSON.parse(readFileSync(resolve(vmDir, "images.json"), "utf8"));

function usage(exitCode = 0) {
  console.log(`Usage: node vm/run-p0-lifecycle.mjs [options]

Options:
  --image-id <id>     images.json id (default: macos26-pristine)
  --rounds <n>        clone/start/check/stop/delete rounds (default: ${config.defaults.lifecycleRounds})
  --dry-run           print the resolved plan without changing Tart state
  --keep-failed       keep a failed ephemeral VM for manual debugging
  --help              show this help

Requires a local pristine image and a passing vm/preflight.mjs. The script
never pulls a remote image and never deletes the configured base image.`);
  process.exit(exitCode);
}

function parseArguments(argv) {
  const parsed = {
    imageId: "macos26-pristine",
    rounds: config.defaults.lifecycleRounds,
    dryRun: false,
    keepFailed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") usage(0);
    if (argument === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (argument === "--keep-failed") {
      parsed.keepFailed = true;
      continue;
    }
    if (argument === "--image-id" || argument === "--rounds") {
      const value = argv[index + 1];
      if (!value) usage(2);
      index += 1;
      if (argument === "--image-id") parsed.imageId = value;
      if (argument === "--rounds") parsed.rounds = Number(value);
      continue;
    }
    console.error(`Unknown argument: ${argument}`);
    usage(2);
  }
  if (!Number.isInteger(parsed.rounds) || parsed.rounds < 1 || parsed.rounds > 20) {
    throw new Error("--rounds must be an integer between 1 and 20");
  }
  return parsed;
}

function tart(args, options = {}) {
  const result = spawnSync("tart", args, {
    encoding: "utf8",
    env: process.env,
    ...options,
  });
  if (!options.allowFailure && result.status !== 0) {
    const output = (result.stderr || result.stdout || "no output").trim();
    throw new Error(`tart ${args[0]} failed (${result.status}): ${output}`);
  }
  return result;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForGuest(vmName, timeoutSeconds) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastFailure = "guest agent not ready";
  let observedRunning = false;
  while (Date.now() < deadline) {
    const result = tart(["exec", vmName, "/usr/bin/sw_vers", "-productVersion"], {
      allowFailure: true,
    });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
    lastFailure = (result.stderr || result.stdout || lastFailure).trim();
    const rows = JSON.parse(tart(["list", "--format", "json"]).stdout);
    const row = rows.find((entry) => (entry.name ?? entry.Name) === vmName);
    const running = Boolean(row && (row.running ?? row.Running));
    observedRunning ||= running;
    if (row && !running && (observedRunning || Date.now() - startedAt > 15_000)) {
      throw new Error(`VM stopped before guest became ready: ${lastFailure}`);
    }
    sleep(2000);
  }
  throw new Error(`guest did not become ready in ${timeoutSeconds}s: ${lastFailure}`);
}

function stopAndDelete(vmName, keep) {
  if (keep) return;
  tart(["stop", vmName], { allowFailure: true });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const deletion = tart(["delete", vmName], { allowFailure: true });
    if (deletion.status === 0) return;
    sleep(1000);
  }
  throw new Error(`failed to delete ephemeral VM ${vmName}`);
}

const args = parseArguments(process.argv.slice(2));
const image = config.images.find((candidate) => candidate.id === args.imageId);
if (!image) throw new Error(`unknown image id: ${args.imageId}`);

const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
const evidenceDir = resolve(macosRoot, "build/acceptance/macos-vm/p0", runId);
const summary = {
  schemaVersion: 1,
  runId,
  startedAt: new Date().toISOString(),
  imageId: image.id,
  baseImage: image.localName,
  sourceDigest: image.sourceDigest,
  tartVersion: tart(["--version"]).stdout.trim(),
  tartHome: resolve(process.env.TART_HOME || `${process.env.HOME}/.tart`),
  requestedRounds: args.rounds,
  dryRun: args.dryRun,
  rounds: [],
  success: false,
};

if (summary.tartVersion !== config.toolchain.tartVersion) {
  throw new Error(`expected Tart ${config.toolchain.tartVersion}, found ${summary.tartVersion}`);
}
if (!image.sourceDigest || !/^sha256:[a-f0-9]{64}$/.test(image.sourceDigest)) {
  throw new Error(`image ${image.id} does not have a pinned source digest`);
}
if (image.status !== "ready") {
  throw new Error(`image ${image.id} is not sealed and ready`);
}

if (args.dryRun) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const allImages = JSON.parse(tart(["list", "--format", "json"]).stdout);
const names = new Set(allImages.map((row) => row.name ?? row.Name).filter(Boolean));
if (!names.has(image.localName)) {
  throw new Error(
    `local base image ${image.localName} is missing; create and seal the pristine image before running lifecycle acceptance`,
  );
}
const digestReference = `${image.bootstrapSource.replace(/:[^/:]+$/, "")}@${image.sourceDigest}`;
if (!names.has(digestReference)) {
  throw new Error(`pinned OCI source is missing from Tart cache: ${digestReference}`);
}

mkdirSync(evidenceDir, { recursive: true });

try {
  for (let roundNumber = 1; roundNumber <= args.rounds; roundNumber += 1) {
    const vmName = `opendrsai-p0-${runId}-${roundNumber}`;
    const round = {
      round: roundNumber,
      vmName,
      startedAt: new Date().toISOString(),
      success: false,
    };
    summary.rounds.push(round);
    let runProcess = null;
    let logFd = null;
    let keepVm = false;
    let vmCreated = false;

    try {
      tart(["clone", image.localName, vmName]);
      vmCreated = true;
      tart([
        "set",
        vmName,
        "--cpu",
        String(config.defaults.cpu),
        "--memory",
        String(config.defaults.memoryMiB),
        "--display",
        config.defaults.display,
        "--random-mac",
      ]);

      const logPath = resolve(evidenceDir, `${vmName}.tart.log`);
      logFd = openSync(logPath, "a");
      runProcess = spawn("tart", ["run", "--no-graphics", "--no-audio", "--no-clipboard", vmName], {
        env: process.env,
        stdio: ["ignore", logFd, logFd],
      });

      round.guestVersion = waitForGuest(vmName, config.defaults.bootTimeoutSeconds);
      const buildVersion = tart(["exec", vmName, "/usr/bin/sw_vers", "-buildVersion"]);
      round.guestBuild = buildVersion.stdout.trim();
      const architecture = tart(["exec", vmName, "/usr/bin/uname", "-m"]);
      round.guestArchitecture = architecture.stdout.trim();
      const p1Toolchain = tart([
        "exec",
        vmName,
        "/bin/sh",
        "-lc",
        [
          "for tool in /usr/bin/codesign /usr/sbin/spctl /usr/bin/xcrun /usr/bin/hdiutil /usr/bin/curl /usr/bin/shasum /usr/bin/open /usr/bin/osascript /usr/sbin/screencapture /usr/bin/ditto /usr/bin/plutil; do test -x \"$tool\" || exit 1; done",
          "/usr/bin/xcrun -f stapler >/dev/null",
          "/usr/bin/sudo -n /usr/bin/true",
        ].join(" && "),
      ]);
      round.p1ToolchainReady = p1Toolchain.status === 0;

      if (Number(round.guestVersion.split(".")[0]) !== image.guestMajorVersion) {
        throw new Error(`expected macOS ${image.guestMajorVersion}, found ${round.guestVersion}`);
      }
      if (round.guestArchitecture !== "arm64") {
        throw new Error(`expected arm64 guest, found ${round.guestArchitecture}`);
      }
      if (!round.p1ToolchainReady) {
        throw new Error("guest is missing a P1 artifact verification tool or passwordless automation sudo");
      }
      if (round.guestVersion !== image.guestVersion) {
        throw new Error(`expected guest version ${image.guestVersion}, found ${round.guestVersion}`);
      }
      if (round.guestBuild !== image.guestBuild) {
        throw new Error(`expected guest build ${image.guestBuild}, found ${round.guestBuild}`);
      }

      round.success = true;
      round.finishedAt = new Date().toISOString();
    } catch (error) {
      round.error = error instanceof Error ? error.message : String(error);
      round.finishedAt = new Date().toISOString();
      keepVm = args.keepFailed;
      throw error;
    } finally {
      try {
        if (vmCreated) stopAndDelete(vmName, keepVm);
      } finally {
        if (runProcess && !runProcess.killed) runProcess.kill("SIGTERM");
        if (logFd !== null) closeSync(logFd);
      }
    }
  }
  summary.success = true;
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  summary.finishedAt = new Date().toISOString();
  writeFileSync(resolve(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}
