#!/usr/bin/env node

import { extractFile } from "@electron/asar";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const vmDir = dirname(fileURLToPath(import.meta.url));
const macosRoot = resolve(vmDir, "..");
const config = JSON.parse(readFileSync(resolve(vmDir, "images.json"), "utf8"));

function usage(exitCode = 0) {
  console.log(`Usage: node vm/run-p1-artifact.mjs [options]

Required:
  --url <https-url>      immutable OSS/CDN DMG URL
  --sha256 <digest>      expected DMG SHA-256
  --commit <sha>         expected clean source commit
  --version <version>    expected App/Runtime version, for example 1.5.8-beta.1

Optional:
  --image-id <id>        images.json id (default: macos26-pristine)
  --dry-run              validate inputs and print the resolved plan only
  --keep-failed          keep a failed ephemeral VM for manual diagnosis
  --help                 show this help`);
  process.exit(exitCode);
}

function parseArguments(argv) {
  const parsed = {
    imageId: "macos26-pristine",
    dryRun: false,
    keepFailed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") usage(0);
    if (argument === "--dry-run" || argument === "--keep-failed") {
      parsed[argument === "--dry-run" ? "dryRun" : "keepFailed"] = true;
      continue;
    }
    const key = {
      "--url": "url",
      "--sha256": "sha256",
      "--commit": "commit",
      "--version": "version",
      "--image-id": "imageId",
    }[argument];
    if (!key || !argv[index + 1]) {
      console.error(`Unknown or incomplete argument: ${argument}`);
      usage(2);
    }
    parsed[key] = argv[index + 1];
    index += 1;
  }
  for (const required of ["url", "sha256", "commit", "version"]) {
    if (!parsed[required]) throw new Error(`--${required} is required`);
  }
  return parsed;
}

function tart(args, options = {}) {
  const result = spawnSync("tart", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `tart ${args[0]} failed (${result.status}): ${(result.stderr || result.stdout || "no output").trim()}`,
    );
  }
  return result;
}

function guest(vmName, command, args = [], options = {}) {
  const result = tart(["exec", vmName, command, ...args], { allowFailure: true });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`guest command failed (${result.status}): ${command} ${args.join(" ")}\n${output}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), output };
}

function guestShell(vmName, script, options = {}) {
  return guest(vmName, "/bin/sh", ["-lc", script], options);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForGuest(vmName, timeoutSeconds) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutSeconds * 1000;
  let observedRunning = false;
  let lastFailure = "guest agent not ready";
  while (Date.now() < deadline) {
    const result = guest(vmName, "/usr/bin/sw_vers", ["-productVersion"], { allowFailure: true });
    if (result.status === 0 && result.stdout) return result.stdout;
    lastFailure = result.output || lastFailure;
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
    if (tart(["delete", vmName], { allowFailure: true }).status === 0) return;
    sleep(1000);
  }
  throw new Error(`failed to delete ephemeral VM ${vmName}`);
}

function validateInputs(args) {
  const url = new URL(args.url);
  if (url.protocol !== "https:") throw new Error("--url must use HTTPS");
  if (url.username || url.password) throw new Error("--url must not include credentials");
  if (url.search || url.hash) throw new Error("--url must not include a query string or fragment");
  if (!config.artifacts.approvedDownloadHosts.includes(url.hostname)) {
    throw new Error(`download host is not approved: ${url.hostname}`);
  }
  if (!/^[a-f0-9]{64}$/.test(args.sha256)) throw new Error("--sha256 must be 64 lowercase hex characters");
  if (!/^[a-f0-9]{40}$/.test(args.commit)) throw new Error("--commit must be a full 40-character Git SHA");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(args.version)) throw new Error("--version is invalid");
  const expectedName = `OpenDrSai-macOS-v${args.version}-arm64.dmg`;
  if (decodeURIComponent(url.pathname.split("/").at(-1)) !== expectedName) {
    throw new Error(`DMG URL must end with ${expectedName}`);
  }
  return url;
}

const args = parseArguments(process.argv.slice(2));
const artifactUrl = validateInputs(args);
const image = config.images.find((candidate) => candidate.id === args.imageId);
if (!image) throw new Error(`unknown image id: ${args.imageId}`);
if (image.status !== "ready" || !image.sourceDigest) throw new Error(`image ${image.id} is not sealed and pinned`);

const allImages = JSON.parse(tart(["list", "--format", "json"]).stdout);
const imageNames = new Set(allImages.map((row) => row.name ?? row.Name).filter(Boolean));
const digestReference = `${image.bootstrapSource.replace(/:[^/:]+$/, "")}@${image.sourceDigest}`;
if (!imageNames.has(image.localName)) throw new Error(`missing local base image: ${image.localName}`);
if (!imageNames.has(digestReference)) throw new Error(`missing pinned OCI source: ${digestReference}`);

const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
const vmName = `opendrsai-p1-${runId}`;
const evidenceDir = resolve(macosRoot, "build/acceptance/macos-vm/p1", runId);
const summary = {
  schemaVersion: 1,
  testId: "macos-vm-p1-final-artifact",
  runId,
  startedAt: new Date().toISOString(),
  imageId: image.id,
  baseImage: image.localName,
  sourceDigest: image.sourceDigest,
  guestVersion: image.guestVersion,
  guestBuild: image.guestBuild,
  artifact: {
    url: artifactUrl.toString(),
    expectedSha256: args.sha256,
    expectedCommit: args.commit,
    expectedVersion: args.version,
  },
  dryRun: args.dryRun,
  checks: {},
  success: false,
};

if (args.dryRun) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

mkdirSync(evidenceDir, { recursive: true });
let vmCreated = false;
let runProcess = null;
let logFd = null;
let keepVm = false;
const guestEvidence = "/Volumes/My Shared Files/evidence";
const guestDmg = "/Users/admin/Downloads/OpenDrSai-candidate.dmg";
const mountPoint = "/Users/admin/Downloads/OpenDrSai Candidate Mount";
const installedApp = "/Applications/OpenDrSai.app";

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

  logFd = openSync(resolve(evidenceDir, `${vmName}.tart.log`), "a");
  runProcess = spawn(
    "tart",
    [
      "run",
      "--no-graphics",
      "--no-audio",
      "--no-clipboard",
      "--dir",
      `evidence:${evidenceDir}`,
      vmName,
    ],
    { env: process.env, stdio: ["ignore", logFd, logFd] },
  );

  const actualGuestVersion = waitForGuest(vmName, config.defaults.bootTimeoutSeconds);
  const actualGuestBuild = guest(vmName, "/usr/bin/sw_vers", ["-buildVersion"]).stdout;
  if (actualGuestVersion !== image.guestVersion || actualGuestBuild !== image.guestBuild) {
    throw new Error(`guest identity drifted: ${actualGuestVersion}/${actualGuestBuild}`);
  }
  summary.checks.guestIdentity = true;

  guestShell(vmName, `mkdir -p /Users/admin/Downloads ${shellQuote(guestEvidence)}`);
  const downloadResult = guest(vmName, "/usr/bin/curl", [
    "-fsSL",
    "--proto",
    "=https",
    "--proto-redir",
    "=https",
    "--tlsv1.2",
    "--connect-timeout",
    "30",
    "--max-time",
    "1800",
    "--dump-header",
    `${guestEvidence}/download.headers`,
    "--write-out",
    "%{http_code}\n%{size_download}\n%{url_effective}\n",
    "--output",
    guestDmg,
    artifactUrl.toString(),
  ]);
  const downloadLines = downloadResult.stdout.trim().split("\n");
  const effectiveUrl = new URL(downloadLines.at(-1));
  const downloadedBytes = Number(downloadLines.at(-2));
  const httpStatus = Number(downloadLines.at(-3));
  if (httpStatus !== 200) throw new Error(`DMG download returned HTTP ${httpStatus}`);
  if (!Number.isSafeInteger(downloadedBytes) || downloadedBytes <= 0) throw new Error("DMG download size is invalid");
  if (effectiveUrl.protocol !== "https:" || !config.artifacts.approvedDownloadHosts.includes(effectiveUrl.hostname)) {
    throw new Error(`DMG redirected to an unapproved location: ${effectiveUrl}`);
  }
  summary.artifact.effectiveUrl = effectiveUrl.toString();
  summary.artifact.httpStatus = httpStatus;
  summary.artifact.downloadedBytes = downloadedBytes;
  const actualDmgSha256 = guestShell(vmName, `/usr/bin/shasum -a 256 ${shellQuote(guestDmg)} | /usr/bin/awk '{print $1}'`).stdout;
  if (actualDmgSha256 !== args.sha256) throw new Error(`DMG SHA-256 mismatch: ${actualDmgSha256}`);
  summary.artifact.actualSha256 = actualDmgSha256;
  summary.checks.downloadAndDigest = true;

  guestShell(vmName, `mkdir -p ${shellQuote(mountPoint)} && /usr/bin/hdiutil attach -readonly -nobrowse -mountpoint ${shellQuote(mountPoint)} ${shellQuote(guestDmg)}`);
  const mountedApp = `${mountPoint}/OpenDrSai.app`;
  guestShell(vmName, `test -d ${shellQuote(mountedApp)} && test ! -e ${shellQuote(installedApp)}`);

  summary.checks.codesign = guest(vmName, "/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", mountedApp]).output;
  summary.checks.gatekeeper = guest(vmName, "/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", mountedApp]).output;
  summary.checks.appStaple = guest(vmName, "/usr/bin/xcrun", ["stapler", "validate", mountedApp]).output;
  summary.checks.dmgStaple = guest(vmName, "/usr/bin/xcrun", ["stapler", "validate", guestDmg]).output;

  const mountedVersion = guest(vmName, "/usr/bin/plutil", [
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    "-o",
    "-",
    `${mountedApp}/Contents/Info.plist`,
  ]).stdout;
  if (mountedVersion !== args.version) throw new Error(`App version mismatch: ${mountedVersion}`);
  summary.artifact.bundleVersion = mountedVersion;

  guestShell(vmName, `/usr/bin/ditto ${shellQuote(`${mountedApp}/Contents/Resources/app.asar`)} ${shellQuote(`${guestEvidence}/app.asar`)}`);
  const appAsarSha256 = guestShell(vmName, `/usr/bin/shasum -a 256 ${shellQuote(`${mountedApp}/Contents/Resources/app.asar`)} | /usr/bin/awk '{print $1}'`).stdout;
  const executableSha256 = guestShell(vmName, `/usr/bin/shasum -a 256 ${shellQuote(`${mountedApp}/Contents/MacOS/OpenDrSai`)} | /usr/bin/awk '{print $1}'`).stdout;
  summary.artifact.appAsarSha256 = appAsarSha256;
  summary.artifact.executableSha256 = executableSha256;

  const runtimeRoot = `${mountedApp}/Contents/Resources/runtime`;
  const runtimeManifest = JSON.parse(guest(vmName, "/bin/cat", [`${runtimeRoot}/runtime-manifest.json`]).stdout);
  if (runtimeManifest.version !== args.version) throw new Error(`Runtime manifest version mismatch: ${runtimeManifest.version}`);
  const runtimeArtifacts = [runtimeManifest.archive, runtimeManifest.sbom, runtimeManifest.provenance];
  for (const name of runtimeArtifacts) {
    if (typeof name !== "string" || basename(name) !== name) throw new Error(`Runtime manifest contains an unsafe artifact name: ${name}`);
  }
  const packagedRuntimeFiles = guestShell(
    vmName,
    `/usr/bin/find ${shellQuote(runtimeRoot)} -maxdepth 1 -type f \( -name 'opendrsai-runtime-macos-arm64-*.tar.gz' -o -name 'runtime-sbom-*.json' -o -name 'runtime-provenance-*.json' \) -exec /usr/bin/basename {} \; | /usr/bin/sort`,
  ).stdout.split("\n").filter(Boolean);
  const expectedRuntimeFiles = [...runtimeArtifacts].sort();
  if (JSON.stringify(packagedRuntimeFiles) !== JSON.stringify(expectedRuntimeFiles)) {
    throw new Error(`Packaged Runtime contains stale or missing artifacts: ${packagedRuntimeFiles.join(", ")}`);
  }
  const runtimeProvenanceText = guest(vmName, "/bin/cat", [`${runtimeRoot}/${runtimeManifest.provenance}`]).stdout;
  const runtimeProvenance = JSON.parse(runtimeProvenanceText);
  if (runtimeProvenance.gitCommit !== args.commit) throw new Error(`Runtime commit mismatch: ${runtimeProvenance.gitCommit}`);
  if (runtimeProvenance.version !== args.version) throw new Error(`Runtime version mismatch: ${runtimeProvenance.version}`);
  summary.runtimeProvenance = runtimeProvenance;
  summary.runtimeManifest = runtimeManifest;
  summary.checks.runtimePackageHygiene = true;

  const asarPath = resolve(evidenceDir, "app.asar");
  const buildMetadata = JSON.parse(extractFile(asarPath, "out/build-metadata.json").toString("utf8"));
  unlinkSync(asarPath);
  if (buildMetadata.commit !== args.commit) throw new Error(`App commit mismatch: ${buildMetadata.commit}`);
  if (buildMetadata.version !== args.version) throw new Error(`App metadata version mismatch: ${buildMetadata.version}`);
  if (buildMetadata.dirty !== false) throw new Error("App build metadata reports a dirty source tree");
  summary.buildMetadata = buildMetadata;
  summary.checks.provenance = true;

  guestShell(vmName, `/usr/bin/sudo -n /usr/bin/ditto ${shellQuote(mountedApp)} ${shellQuote(installedApp)}`);
  guest(vmName, "/usr/bin/hdiutil", ["detach", mountPoint]);
  summary.checks.install = true;

  guest(vmName, "/usr/bin/open", [installedApp]);
  const launchProbe = guestShell(vmName, "i=0; while test $i -lt 60; do /usr/bin/pgrep -x OpenDrSai >/dev/null && exit 0; /bin/sleep 1; i=$((i + 1)); done; exit 1");
  if (launchProbe.status !== 0) throw new Error("OpenDrSai did not stay running after launch");
  guestShell(vmName, `/bin/sleep 5; /usr/bin/pgrep -x OpenDrSai >/dev/null; /usr/sbin/screencapture -x ${shellQuote(`${guestEvidence}/first-launch.png`)}`);
  summary.checks.blackBoxLaunch = true;
  summary.checks.screenshot = "first-launch.png";

  guest(vmName, "/usr/bin/osascript", ["-e", 'tell application "OpenDrSai" to quit']);
  guestShell(vmName, "i=0; while test $i -lt 30; do /usr/bin/pgrep -x OpenDrSai >/dev/null || exit 0; /bin/sleep 1; i=$((i + 1)); done; exit 1");
  const residualProcesses = guestShell(
    vmName,
    "/bin/ps -axo pid=,command= | /usr/bin/grep -E '[O]penDrSai|[d]rsai gateway|[d]rsai-agent' || true",
  ).stdout;
  if (residualProcesses) throw new Error(`residual processes after quit:\n${residualProcesses}`);
  summary.checks.quitAndCleanup = true;
  summary.residualProcesses = [];

  guestShell(
    vmName,
    `if test -d "$HOME/Library/Logs/OpenDrSai"; then /usr/bin/ditto "$HOME/Library/Logs/OpenDrSai" ${shellQuote(`${guestEvidence}/app-logs`)}; fi`,
  );
  summary.success = true;
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error);
  keepVm = args.keepFailed;
  process.exitCode = 1;
} finally {
  if (vmCreated) {
    guest(vmName, "/usr/bin/hdiutil", ["detach", mountPoint], { allowFailure: true });
    try {
      stopAndDelete(vmName, keepVm);
    } catch (cleanupError) {
      summary.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      summary.success = false;
      process.exitCode = 1;
    }
  }
  if (runProcess && !runProcess.killed) runProcess.kill("SIGTERM");
  if (logFd !== null) closeSync(logFd);
  summary.finishedAt = new Date().toISOString();
  summary.keptFailedVm = keepVm;
  writeFileSync(resolve(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
}
