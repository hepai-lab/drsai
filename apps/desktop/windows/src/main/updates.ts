import { execFile } from "child_process";
import { createHash, randomUUID } from "crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { copyFile, mkdir, rename, rm, stat } from "fs/promises";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { promisify } from "util";
import { app, type WebContents } from "electron";
import type { UpdateStatus } from "../shared/desktopApi";
import { DRSAI_REPO } from "./paths";

const execFileAsync = promisify(execFile);
const UPDATE_SCHEMA_VERSION = 1;
const DEFAULT_MANIFEST_URL =
  "https://github.com/hepai-lab/drsai/releases/latest/download/latest-windows.json";
const MAX_MANIFEST_BYTES = 64 * 1024;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_STARTUP_DELAY_MS = 30 * 1000;
const ALLOWED_UPDATE_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

interface RuntimeUpdateManifest {
  schemaVersion: number;
  version: string;
  channel: "stable" | "beta" | "dev";
  publishedAt: string;
  minimumUpdaterVersion: string;
  mandatory: boolean;
  requireSignature: boolean;
  runtime: {
    url: string;
    sizeBytes: number;
    sha256: string;
  };
  releaseNotesUrl: string | null;
}

interface PreparedUpdate {
  manifest: RuntimeUpdateManifest;
  archivePath: string;
  stagingRoot: string;
  updaterPath: string;
  installRoot: string;
  agentDir: string;
  statePath: string;
}

let updateStatus: UpdateStatus = idleStatus();
let selectedManifest: RuntimeUpdateManifest | null = null;
let preparedUpdate: PreparedUpdate | null = null;
let activeDownload: AbortController | null = null;
let schedulerStarted = false;
const subscribers = new Set<WebContents>();

export function getUpdateStatus(): UpdateStatus {
  return updateStatus;
}

export function subscribeUpdateStatus(webContents: WebContents): void {
  subscribers.add(webContents);
  webContents.once("destroyed", () => subscribers.delete(webContents));
  emitStatus();
}

export function startUpdateScheduler(): void {
  if (schedulerStarted || !app.isPackaged || process.env.OPENDRSAI_DISABLE_AUTO_UPDATE === "1") return;
  schedulerStarted = true;
  const startupTimer = setTimeout(() => void checkForUpdates(), UPDATE_STARTUP_DELAY_MS);
  startupTimer.unref();
  const interval = setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
  interval.unref();
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged && process.env.OPENDRSAI_ENABLE_DEV_UPDATES !== "1") {
    return fail("not-packaged", "Updates are only checked in packaged builds.");
  }
  if (activeDownload) return updateStatus;
  if (preparedUpdate && existsSync(join(preparedUpdate.stagingRoot, "runtime"))) return updateStatus;

  setStatus(statusFor("checking", { checking: true }));
  try {
    const manifest = await fetchManifest(getManifestUrl());
    assertManifestUsable(manifest);
    selectedManifest = manifest;
    preparedUpdate = null;
    if (compareSemver(manifest.version, app.getVersion()) <= 0) {
      selectedManifest = null;
      setStatus(idleStatus());
      return updateStatus;
    }
    setStatus(statusFor("available", {
      available: true,
      version: manifest.version,
      mandatory: manifest.mandatory,
      releaseNotesUrl: manifest.releaseNotesUrl,
      canDownload: true,
    }));
  } catch (error) {
    return fail(errorCode(error), errorMessage(error));
  }
  return updateStatus;
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (preparedUpdate && existsSync(join(preparedUpdate.stagingRoot, "runtime"))) return updateStatus;
  if (!selectedManifest) {
    await checkForUpdates();
  }
  const manifest = selectedManifest;
  if (!manifest || !updateStatus.available) return updateStatus;
  if (activeDownload) return updateStatus;

  const paths = resolveUpdatePaths(manifest.version);
  activeDownload = new AbortController();
  try {
    await mkdir(dirname(paths.archivePath), { recursive: true });
    setStatus(statusFor("downloading", {
      available: true,
      downloading: true,
      version: manifest.version,
      mandatory: manifest.mandatory,
      releaseNotesUrl: manifest.releaseNotesUrl,
      canCancel: true,
      progress: 0,
    }));
    await downloadRuntime(manifest, paths.archivePath, activeDownload.signal);
    setStatus(statusFor("verifying", updateIdentity(manifest)));
    await verifyFile(paths.archivePath, manifest.runtime.sizeBytes, manifest.runtime.sha256);

    setStatus(statusFor("staging", updateIdentity(manifest)));
    await installStableUpdater(paths.updaterPath);
    await rm(paths.stagingRoot, { recursive: true, force: true });
    await runUpdater(paths.updaterPath, [
      "-Mode", "Prepare",
      "-ArchivePath", paths.archivePath,
      "-StagingRoot", paths.stagingRoot,
      "-InstallRoot", paths.installRoot,
      "-AgentDir", paths.agentDir,
      "-ExpectedVersion", manifest.version,
      "-ExpectedSha256", manifest.runtime.sha256,
      "-ExpectedSizeBytes", String(manifest.runtime.sizeBytes),
      "-CurrentExecutable", app.getPath("exe"),
      "-RequireSignature", manifest.requireSignature ? "1" : "0",
      "-AllowUnsigned", allowUnsignedUpdates() ? "1" : "0",
      "-StatePath", paths.statePath,
    ]);
    writeFileSync(
      join(paths.stagingRoot, "prepared-update.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    preparedUpdate = { manifest, ...paths };
    setStatus(statusFor("ready", {
      ...updateIdentity(manifest),
      available: true,
      downloaded: true,
      progress: 100,
      canInstall: true,
    }));
  } catch (error) {
    if (isAbortError(error)) {
      setStatus(statusFor("available", {
        ...updateIdentity(manifest),
        available: true,
        canDownload: true,
      }));
    } else {
      fail(errorCode(error), errorMessage(error), manifest);
    }
  } finally {
    activeDownload = null;
  }
  return updateStatus;
}

export async function cancelUpdate(): Promise<UpdateStatus> {
  activeDownload?.abort();
  return updateStatus;
}

export async function installUpdate(): Promise<UpdateStatus> {
  const prepared = preparedUpdate;
  if (!prepared || !existsSync(prepared.stagingRoot)) {
    return fail("update-not-ready", "The update is not downloaded and staged.", selectedManifest ?? undefined);
  }
  const token = randomUUID();
  setStatus(statusFor("installing", {
    ...updateIdentity(prepared.manifest),
    available: true,
    downloaded: true,
    progress: 100,
  }));
  const updaterArgs = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", prepared.updaterPath,
    "-Mode", "Apply",
    "-ArchivePath", prepared.archivePath,
    "-StagingRoot", prepared.stagingRoot,
    "-InstallRoot", prepared.installRoot,
    "-AgentDir", prepared.agentDir,
    "-ExpectedVersion", prepared.manifest.version,
    "-WaitPid", String(process.pid),
    "-HealthToken", token,
    "-StatePath", prepared.statePath,
    "-CurrentExecutable", app.getPath("exe"),
    "-RequireSignature", prepared.manifest.requireSignature ? "1" : "0",
    "-AllowUnsigned", allowUnsignedUpdates() ? "1" : "0",
  ];
  try {
    await launchElevatedUpdater(updaterArgs);
  } catch (error) {
    return fail("elevation-failed", errorMessage(error), prepared.manifest);
  }
  setTimeout(() => app.quit(), 500).unref();
  return updateStatus;
}

export function confirmPendingUpdateLaunch(): void {
  const tokenArg = process.argv.find((arg) => arg.startsWith("--opendrsai-update-token="));
  if (!tokenArg) return;
  const token = tokenArg.slice("--opendrsai-update-token=".length).trim();
  if (!/^[a-f0-9-]{20,80}$/i.test(token)) return;
  const stateArg = process.argv.find((arg) => arg.startsWith("--opendrsai-update-state="));
  const statePath = stateArg?.slice("--opendrsai-update-state=".length).trim();
  const markerRoot = statePath ? dirname(resolve(statePath)) : getUpdateRoot();
  const marker = join(markerRoot, `health-${token}.ok`);
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, `${app.getVersion()}\n`, "utf8");
}

export function restorePreparedUpdate(): void {
  if (!app.isPackaged && process.env.OPENDRSAI_ENABLE_DEV_UPDATES !== "1") return;
  try {
    const statePath = join(getUpdateRoot(), "update-state.json");
    if (!existsSync(statePath)) return;
    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      phase?: unknown;
      version?: unknown;
      message?: unknown;
    };
    if (state.phase === "rolled-back" && typeof state.version === "string") {
      setStatus(statusFor("rolled-back", {
        version: state.version,
        errorCode: "update-rolled-back",
        error: typeof state.message === "string" ? state.message : null,
        recovery: "automatic-rollback",
      }));
      return;
    }
    if (state.phase !== "ready" || typeof state.version !== "string") return;
    const paths = resolveUpdatePaths(state.version);
    const metadataPath = join(paths.stagingRoot, "prepared-update.json");
    if (!existsSync(metadataPath) || !existsSync(join(paths.stagingRoot, "runtime"))) return;
    const manifest = parseManifest(JSON.parse(readFileSync(metadataPath, "utf8")));
    assertManifestUsable(manifest);
    if (compareSemver(manifest.version, app.getVersion()) <= 0) return;
    preparedUpdate = { manifest, ...paths };
    selectedManifest = manifest;
    setStatus(statusFor("ready", {
      ...updateIdentity(manifest),
      available: true,
      downloaded: true,
      progress: 100,
      canInstall: true,
    }));
  } catch (error) {
    console.warn("[desktop] Ignoring invalid prepared update:", errorMessage(error));
  }
}

function idleStatus(): UpdateStatus {
  return statusFor("idle");
}

function statusFor(
  phase: UpdateStatus["phase"],
  overrides: Partial<UpdateStatus> = {},
): UpdateStatus {
  return {
    phase,
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    progress: null,
    version: null,
    currentVersion: app.getVersion(),
    mandatory: false,
    releaseNotesUrl: null,
    canDownload: false,
    canInstall: false,
    canCancel: false,
    errorCode: null,
    error: null,
    recovery: null,
    ...overrides,
  };
}

function updateIdentity(manifest: RuntimeUpdateManifest): Partial<UpdateStatus> {
  return {
    version: manifest.version,
    mandatory: manifest.mandatory,
    releaseNotesUrl: manifest.releaseNotesUrl,
  };
}

function fail(code: string, message: string, manifest?: RuntimeUpdateManifest): UpdateStatus {
  setStatus(statusFor("failed", {
    ...(manifest ? updateIdentity(manifest) : {}),
    available: Boolean(manifest),
    canDownload: Boolean(manifest),
    errorCode: code,
    error: message,
  }));
  return updateStatus;
}

function setStatus(status: UpdateStatus): void {
  updateStatus = status;
  emitStatus();
}

function emitStatus(): void {
  for (const webContents of subscribers) {
    if (!webContents.isDestroyed()) webContents.send("desktop:update-status", updateStatus);
  }
}

function getManifestUrl(): string {
  return process.env.OPENDRSAI_UPDATE_MANIFEST_URL?.trim() || DEFAULT_MANIFEST_URL;
}

async function fetchManifest(rawUrl: string): Promise<RuntimeUpdateManifest> {
  const url = assertAllowedUpdateUrl(rawUrl, "manifest");
  const response = await fetchWithTrustedRedirects(url, "manifest", {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw updateError("manifest-http", `Update manifest request failed with HTTP ${response.status}.`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES) {
    throw updateError("manifest-too-large", "Update manifest exceeds the allowed size.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw updateError("manifest-json", "Update manifest is not valid JSON.");
  }
  return parseManifest(parsed);
}

function parseManifest(value: unknown): RuntimeUpdateManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw updateError("manifest-shape", "Update manifest must be an object.");
  }
  const input = value as Record<string, unknown>;
  const runtime = input.runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw updateError("manifest-runtime", "Update manifest is missing runtime metadata.");
  }
  const runtimeInput = runtime as Record<string, unknown>;
  const manifest: RuntimeUpdateManifest = {
    schemaVersion: Number(input.schemaVersion),
    version: requireString(input.version, "version"),
    channel: requireChannel(input.channel),
    publishedAt: requireString(input.publishedAt, "publishedAt"),
    minimumUpdaterVersion: requireString(input.minimumUpdaterVersion, "minimumUpdaterVersion"),
    mandatory: input.mandatory === true,
    requireSignature: input.requireSignature !== false,
    runtime: {
      url: requireString(runtimeInput.url, "runtime.url"),
      sizeBytes: Number(runtimeInput.sizeBytes),
      sha256: requireString(runtimeInput.sha256, "runtime.sha256").toLowerCase(),
    },
    releaseNotesUrl: typeof input.releaseNotesUrl === "string" ? input.releaseNotesUrl.trim() || null : null,
  };
  if (manifest.schemaVersion !== UPDATE_SCHEMA_VERSION) throw updateError("manifest-schema", "Unsupported update manifest schema version.");
  parseSemver(manifest.version);
  parseSemver(manifest.minimumUpdaterVersion);
  if (!Number.isSafeInteger(manifest.runtime.sizeBytes) || manifest.runtime.sizeBytes <= 0) throw updateError("manifest-size", "Runtime size is invalid.");
  if (!/^[a-f0-9]{64}$/.test(manifest.runtime.sha256)) throw updateError("manifest-hash", "Runtime SHA-256 is invalid.");
  if (!Number.isFinite(Date.parse(manifest.publishedAt))) throw updateError("manifest-date", "Manifest publication time is invalid.");
  assertAllowedUpdateUrl(manifest.runtime.url, "runtime");
  if (manifest.releaseNotesUrl) assertAllowedUpdateUrl(manifest.releaseNotesUrl, "release notes");
  return manifest;
}

function assertManifestUsable(manifest: RuntimeUpdateManifest): void {
  if (compareSemver(app.getVersion(), manifest.minimumUpdaterVersion) < 0) {
    throw updateError("updater-too-old", `OpenDrSai ${manifest.minimumUpdaterVersion} or newer is required to install this update.`);
  }
  const requestedChannel = (process.env.OPENDRSAI_UPDATE_CHANNEL || "stable").toLowerCase();
  if (manifest.channel !== requestedChannel) throw updateError("channel-mismatch", `The ${manifest.channel} update does not match the ${requestedChannel} channel.`);
}

function assertAllowedUpdateUrl(rawUrl: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw updateError("invalid-url", `The ${label} URL is invalid.`);
  }
  const insecureTestUrl = allowInsecureUpdates() && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !(insecureTestUrl && url.protocol === "http:")) {
    throw updateError("unsafe-url", `The ${label} URL must use HTTPS.`);
  }
  if (!ALLOWED_UPDATE_HOSTS.has(url.hostname.toLowerCase()) && !insecureTestUrl) {
    throw updateError("untrusted-host", `The ${label} host is not allowed.`);
  }
  if (url.username || url.password) throw updateError("unsafe-url", `The ${label} URL must not include credentials.`);
  return url;
}

async function downloadRuntime(manifest: RuntimeUpdateManifest, archivePath: string, signal: AbortSignal): Promise<void> {
  const partialPath = `${archivePath}.partial`;
  let offset = 0;
  try {
    offset = (await stat(partialPath)).size;
    if (offset > manifest.runtime.sizeBytes) {
      await rm(partialPath, { force: true });
      offset = 0;
    }
  } catch {
    offset = 0;
  }
  const headers: Record<string, string> = {};
  if (offset > 0) headers.Range = `bytes=${offset}-`;
  const response = await fetchWithTrustedRedirects(
    assertAllowedUpdateUrl(manifest.runtime.url, "runtime"),
    "runtime",
    { headers, signal },
  );
  if (!response.ok || !response.body) throw updateError("download-http", `Runtime download failed with HTTP ${response.status}.`);
  const resumed = offset > 0 && response.status === 206;
  if (!resumed && offset > 0) {
    await rm(partialPath, { force: true });
    offset = 0;
  }
  let received = offset;
  const source = Readable.fromWeb(response.body as never);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    const percent = Math.min(100, (received / manifest.runtime.sizeBytes) * 100);
    setStatus(statusFor("downloading", {
      ...updateIdentity(manifest),
      available: true,
      downloading: true,
      canCancel: true,
      progress: percent,
    }));
  });
  await pipeline(source, createWriteStream(partialPath, { flags: resumed ? "a" : "w" }));
  await rm(archivePath, { force: true });
  await rename(partialPath, archivePath);
}

async function fetchWithTrustedRedirects(
  initialUrl: URL,
  label: string,
  options: RequestInit,
): Promise<Response> {
  let url = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url, { ...options, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw updateError("redirect-missing", `The ${label} redirect has no destination.`);
    if (redirects === 5) throw updateError("redirect-limit", `The ${label} request has too many redirects.`);
    url = assertAllowedUpdateUrl(new URL(location, url).href, `${label} redirect`);
  }
  throw updateError("redirect-limit", `The ${label} request has too many redirects.`);
}

async function verifyFile(path: string, expectedSize: number, expectedHash: string): Promise<void> {
  const info = await stat(path);
  if (info.size !== expectedSize) throw updateError("size-mismatch", `Runtime size mismatch: expected ${expectedSize}, got ${info.size}.`);
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  const actual = hash.digest("hex");
  if (actual !== expectedHash) {
    await rm(path, { force: true });
    throw updateError("hash-mismatch", "Runtime SHA-256 verification failed.");
  }
}

function resolveUpdatePaths(version: string): Omit<PreparedUpdate, "manifest"> {
  const installRoot = getInstallRoot();
  const updateRoot = getUpdateRoot();
  const updaterDir = join(updateRoot, "updater");
  return {
    archivePath: join(updateRoot, "cache", version, "OpenDrSaiRuntime-win-x64.zip"),
    stagingRoot: join(updateRoot, "staging", version),
    updaterPath: join(updaterDir, "update-opendrsai.ps1"),
    installRoot,
    agentDir: process.env.OPENDRSAI_UPDATE_AGENT_DIR?.trim() || DRSAI_REPO,
    statePath: join(updateRoot, "update-state.json"),
  };
}

function getUpdateRoot(): string {
  const override = process.env.OPENDRSAI_UPDATE_DATA_ROOT?.trim();
  if (override) return resolve(override);
  const localAppData = process.env.LOCALAPPDATA?.trim();
  return localAppData
    ? join(localAppData, "OpenDrSai", "updates")
    : join(app.getPath("userData"), "updates");
}

function getInstallRoot(): string {
  const override = process.env.OPENDRSAI_UPDATE_INSTALL_ROOT?.trim();
  if (override) return resolve(override);
  if (app.isPackaged) return dirname(dirname(app.getPath("exe")));
  return join(homedir(), "AppData", "Local", "Programs", "OpenDrSai");
}

async function installStableUpdater(target: string): Promise<void> {
  const source = process.env.OPENDRSAI_UPDATE_HELPER_PATH?.trim() || join(process.resourcesPath, "update", "update-opendrsai.ps1");
  if (!existsSync(source)) throw updateError("updater-missing", `Update helper is missing: ${source}`);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function runUpdater(path: string, args: string[]): Promise<void> {
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path, ...args], {
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const stderr = typeof error === "object" && error && "stderr" in error ? String(error.stderr).trim() : "";
    throw updateError("staging-failed", stderr || errorMessage(error));
  }
}

async function launchElevatedUpdater(args: string[]): Promise<void> {
  if (process.platform !== "win32") {
    throw updateError("elevation-unsupported", "Elevated runtime installation is only supported on Windows.");
  }
  const commandLine = args.map(quoteWindowsCommandLineArgument).join(" ");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Start-Process -FilePath 'powershell.exe' -ArgumentList ${quotePowerShellLiteral(commandLine)} -Verb RunAs -WindowStyle Hidden | Out-Null`,
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const stderr = typeof error === "object" && error && "stderr" in error ? String(error.stderr).trim() : "";
    throw updateError("elevation-failed", stderr || "Administrator approval is required to update OpenDrSai in Program Files.");
  }
}

function quoteWindowsCommandLineArgument(value: string): string {
  if (value.includes('"')) throw updateError("unsafe-update-argument", "The update path contains an unsupported quote character.");
  return `"${value.replace(/(\\+)$/g, "$1$1")}"`;
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw updateError("manifest-field", `Update manifest field ${field} is required.`);
  return value.trim();
}

function requireChannel(value: unknown): RuntimeUpdateManifest["channel"] {
  if (value === "stable" || value === "beta" || value === "dev") return value;
  throw updateError("manifest-channel", "Update manifest channel is invalid.");
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function parseSemver(value: string): { core: [number, number, number]; prerelease: string[] } {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) throw updateError("invalid-version", `Invalid semantic version: ${value}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function allowInsecureUpdates(): boolean {
  return process.env.OPENDRSAI_ALLOW_INSECURE_UPDATE_URLS === "1" &&
    (process.env.NODE_ENV !== "production" || process.env.OPENDRSAI_E2E_SMOKE === "1");
}

function allowUnsignedUpdates(): boolean {
  return process.env.OPENDRSAI_ALLOW_UNSIGNED_UPDATES === "1" &&
    (process.env.NODE_ENV !== "production" || process.env.OPENDRSAI_E2E_SMOKE === "1");
}

function updateError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "update-failed";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
}
