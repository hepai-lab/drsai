#!/usr/bin/env node

import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const vmDir = dirname(fileURLToPath(import.meta.url));
const macosRoot = resolve(vmDir, "..");
const config = JSON.parse(readFileSync(resolve(vmDir, "images.json"), "utf8"));
const imageId = process.argv[2] ?? "macos26-pristine";
const image = config.images.find((candidate) => candidate.id === imageId);

if (!image) throw new Error(`unknown image id: ${imageId}`);

function tart(args, options = {}) {
  const result = spawnSync("tart", args, {
    encoding: "utf8",
    env: process.env,
    ...options,
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `tart ${args[0]} failed (${result.status}): ${(result.stderr || result.stdout || "no output").trim()}`,
    );
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

function guest(vmName, command, ...args) {
  return tart(["exec", vmName, command, ...args]).stdout.trim();
}

const tartVersion = tart(["--version"]).stdout.trim();
if (tartVersion !== config.toolchain.tartVersion) {
  throw new Error(`expected Tart ${config.toolchain.tartVersion}, found ${tartVersion}`);
}

const localImages = JSON.parse(tart(["list", "--format", "json"]).stdout);
const listEntry = localImages.find((entry) => (entry.name ?? entry.Name) === image.localName);
if (!listEntry) throw new Error(`local base image not found: ${image.localName}`);
const digestEntry = localImages.find((entry) => {
  const name = entry.name ?? entry.Name ?? "";
  return name.startsWith("ghcr.io/cirruslabs/macos-tahoe-base@sha256:");
});

const evidenceDir = resolve(macosRoot, "build/acceptance/macos-vm/base-images");
const logPath = resolve(evidenceDir, `${image.id}.tart.log`);
const receiptPath = resolve(evidenceDir, `${image.id}.json`);
mkdirSync(evidenceDir, { recursive: true });

const receipt = {
  schemaVersion: 1,
  imageId: image.id,
  localName: image.localName,
  bootstrapSource: image.bootstrapSource,
  sourceDigest: digestEntry ? (digestEntry.name ?? digestEntry.Name).split("@")[1] : image.sourceDigest,
  startedAt: new Date().toISOString(),
  tartVersion,
  tartHome: resolve(process.env.TART_HOME || `${process.env.HOME}/.tart`),
  passed: false,
};

let runProcess = null;
let logFd = null;

try {
  tart([
    "set",
    image.localName,
    "--cpu",
    String(config.defaults.cpu),
    "--memory",
    String(config.defaults.memoryMiB),
    "--disk-size",
    String(config.defaults.diskGiB),
    "--display",
    config.defaults.display,
  ]);

  receipt.tartConfig = JSON.parse(tart(["get", image.localName, "--format", "json"]).stdout);
  receipt.tartListEntry = listEntry;

  logFd = openSync(logPath, "a");
  runProcess = spawn(
    "tart",
    ["run", "--no-graphics", "--no-audio", "--no-clipboard", image.localName],
    { env: process.env, stdio: ["ignore", logFd, logFd] },
  );

  receipt.guestVersion = waitForGuest(image.localName, config.defaults.bootTimeoutSeconds);
  receipt.guestBuild = guest(image.localName, "/usr/bin/sw_vers", "-buildVersion");
  receipt.guestArchitecture = guest(image.localName, "/usr/bin/uname", "-m");
  receipt.guestUser = guest(image.localName, "/usr/bin/id", "-un");
  receipt.guestRootFilesystem = guest(image.localName, "/bin/df", "-Pk", "/");

  if (Number(receipt.guestVersion.split(".")[0]) !== image.guestMajorVersion) {
    throw new Error(`expected macOS ${image.guestMajorVersion}, found ${receipt.guestVersion}`);
  }
  if (receipt.guestArchitecture !== "arm64") {
    throw new Error(`expected arm64 guest, found ${receipt.guestArchitecture}`);
  }
  if (receipt.guestUser !== image.username) {
    throw new Error(`expected guest user ${image.username}, found ${receipt.guestUser}`);
  }
  if (image.guestVersion && receipt.guestVersion !== image.guestVersion) {
    throw new Error(`expected guest version ${image.guestVersion}, found ${receipt.guestVersion}`);
  }
  if (image.guestBuild && receipt.guestBuild !== image.guestBuild) {
    throw new Error(`expected guest build ${image.guestBuild}, found ${receipt.guestBuild}`);
  }
  if (!receipt.sourceDigest || receipt.sourceDigest !== image.sourceDigest) {
    throw new Error(`expected source digest ${image.sourceDigest}, found ${receipt.sourceDigest ?? "none"}`);
  }

  const residueProbe = tart([
    "exec",
    image.localName,
    "/bin/sh",
    "-lc",
    [
      'test ! -e "/Applications/OpenDrSai.app"',
      'test ! -e "$HOME/.drsai"',
      'test ! -e "$HOME/Library/Application Support/OpenDrSai"',
      'test ! -e "$HOME/Library/Application Support/opendrsai"',
    ].join(" && "),
  ], { allowFailure: true });
  if (residueProbe.status !== 0) {
    throw new Error("base image contains OpenDrSai application or user-data residue");
  }
  receipt.openDrSaiResidue = false;
  receipt.passed = true;
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  tart(["stop", image.localName], { allowFailure: true });
  if (runProcess && !runProcess.killed) runProcess.kill("SIGTERM");
  if (logFd !== null) closeSync(logFd);
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
}
