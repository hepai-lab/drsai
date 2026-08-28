#!/usr/bin/env node

import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { arch, homedir, platform, totalmem } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const vmDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(vmDir, "../../../..");
const config = JSON.parse(readFileSync(resolve(vmDir, "images.json"), "utf8"));
const jsonOutput = process.argv.includes("--json");

if (process.argv.some((argument) => argument === "--help" || argument === "-h")) {
  console.log(`Usage: node vm/preflight.mjs [--json]

Checks whether the current Apple Silicon Mac can run the OpenDrSai macOS VM
acceptance harness. TART_HOME should point to an APFS volume with at least
${config.host.minimumFreeGiB} GiB free (${config.host.recommendedFreeGiB} GiB recommended).`);
  process.exit(0);
}

const checks = [];

function addCheck(id, status, detail, remediation = null) {
  checks.push({ id, status, detail, ...(remediation ? { remediation } : {}) });
}

function run(command, args = [], options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    ...options,
  });
}

function commandPath(command) {
  const result = run("/usr/bin/which", [command]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function parseVersion(value) {
  const match = String(value).match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? match.slice(1).map((part) => Number(part ?? 0)) : null;
}

function existingAncestor(path) {
  let candidate = resolve(path);
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
  return candidate;
}

function gib(bytes) {
  return Number(bytes) / 1024 / 1024 / 1024;
}

function isWithin(parent, child) {
  const candidate = relative(parent, child);
  return candidate === "" || (!candidate.startsWith("..") && !isAbsolute(candidate));
}

if (platform() === "darwin") {
  addCheck("host.platform", "pass", "darwin");
} else {
  addCheck("host.platform", "fail", platform(), "P0 必须在 macOS 宿主机运行。");
}

if (arch() === "arm64") {
  addCheck("host.architecture", "pass", "arm64");
} else {
  addCheck("host.architecture", "fail", arch(), "macOS guest 需要 Apple Silicon 宿主机。");
}

const swVers = run("/usr/bin/sw_vers", ["-productVersion"]);
const macosVersion = swVers.status === 0 ? swVers.stdout.trim() : "unknown";
const parsedMacosVersion = parseVersion(macosVersion);
if (parsedMacosVersion && parsedMacosVersion[0] >= 13) {
  addCheck("host.macos", "pass", macosVersion);
} else {
  addCheck("host.macos", "fail", macosVersion, "Tart 要求 macOS 13 或更高版本。");
}

const memoryGiB = gib(totalmem());
if (memoryGiB >= config.host.minimumMemoryGiB) {
  addCheck("host.memory", "pass", `${memoryGiB.toFixed(1)} GiB`);
} else {
  addCheck(
    "host.memory",
    "fail",
    `${memoryGiB.toFixed(1)} GiB`,
    `至少需要 ${config.host.minimumMemoryGiB} GiB；低内存宿主机不进入 VM 发布验收。`,
  );
}

const virtualizationFramework = "/System/Library/Frameworks/Virtualization.framework";
const hasVirtualizationFramework = existsSync(virtualizationFramework);
addCheck(
  "host.virtualizationFramework",
  hasVirtualizationFramework ? "pass" : "fail",
  virtualizationFramework,
  hasVirtualizationFramework ? null : "系统缺少 Apple Virtualization.framework。",
);

const requiredTools = [
  "brew",
  "tart",
  "xcodebuild",
  "codesign",
  "xcrun",
  "hdiutil",
  "spctl",
  "jq",
  "ssh",
  "shasum",
];

for (const tool of requiredTools) {
  const path = commandPath(tool);
  addCheck(
    `tool.${tool}`,
    path ? "pass" : "fail",
    path ?? "not found",
    path ? null : `安装或恢复 ${tool} 后重新运行 preflight。`,
  );
}

const nodeVersion = process.versions.node;
const nodeMajor = Number(nodeVersion.split(".")[0]);
if (nodeMajor === config.toolchain.nodeMajor) {
  addCheck("tool.node", "pass", nodeVersion);
} else {
  addCheck(
    "tool.node",
    "fail",
    nodeVersion,
    `切换到 Node ${config.toolchain.nodeMajor}.x。`,
  );
}

const tartPath = commandPath("tart");
if (tartPath) {
  const tartVersionResult = run(tartPath, ["--version"]);
  const tartVersion = tartVersionResult.status === 0 ? tartVersionResult.stdout.trim() : "unknown";
  if (tartVersion === config.toolchain.tartVersion) {
    addCheck("tool.tartVersion", "pass", tartVersion);
  } else {
    addCheck(
      "tool.tartVersion",
      "fail",
      tartVersion,
      `安装固定版本 Tart ${config.toolchain.tartVersion}，并同步更新 images.json 后再升级。`,
    );
  }
}

const tartHome = resolve(process.env.TART_HOME || join(homedir(), ".tart"));
const tartAncestor = existingAncestor(tartHome);

if (isWithin(repositoryRoot, tartHome)) {
  addCheck(
    "storage.location",
    "fail",
    tartHome,
    "TART_HOME 不得放在 Git 仓库内；请指向专用 APFS 卷或 ~/.tart。",
  );
} else {
  addCheck("storage.location", "pass", tartHome);
}

if (!tartAncestor) {
  addCheck("storage.writable", "fail", tartHome, "无法解析 TART_HOME 的可用父目录。");
} else {
  try {
    accessSync(tartAncestor, constants.W_OK);
    addCheck("storage.writable", "pass", tartAncestor);
  } catch {
    addCheck(
      "storage.writable",
      "fail",
      tartAncestor,
      "当前用户不能写入 TART_HOME 所在卷。",
    );
  }

  try {
    const dfResult = run("/bin/df", ["-Pk", tartAncestor]);
    if (dfResult.status !== 0) throw new Error((dfResult.stderr || "df failed").trim());
    const lines = dfResult.stdout.trim().split("\n");
    const columns = lines.at(-1).trim().split(/\s+/);
    const filesystemDevice = columns[0];
    const availableKiB = Number(columns[3]);
    if (!Number.isFinite(availableKiB)) throw new Error("unable to parse df available blocks");

    const mountResult = run("/sbin/mount");
    const mountLine = mountResult.stdout
      .split("\n")
      .find((line) => line.startsWith(`${filesystemDevice} on `));
    const filesystem = mountLine?.match(/\(([^,]+)/)?.[1] ?? "unknown";
    if (filesystem === "apfs") {
      addCheck("storage.filesystem", "pass", filesystem);
    } else {
      addCheck(
        "storage.filesystem",
        "fail",
        filesystem,
        "TART_HOME 必须位于 APFS 卷，以支持可靠的 copy-on-write clone。",
      );
    }

    const freeGiB = gib(availableKiB * 1024);
    if (freeGiB >= config.host.recommendedFreeGiB) {
      addCheck("storage.free", "pass", `${freeGiB.toFixed(1)} GiB`);
    } else if (freeGiB >= config.host.minimumFreeGiB) {
      addCheck(
        "storage.free",
        "warn",
        `${freeGiB.toFixed(1)} GiB`,
        `可以开始 P0，但建议预留 ${config.host.recommendedFreeGiB} GiB。`,
      );
    } else {
      addCheck(
        "storage.free",
        "fail",
        `${freeGiB.toFixed(1)} GiB`,
        `释放至至少 ${config.host.minimumFreeGiB} GiB，或将 TART_HOME 指向预留 150 GiB 的外置 APFS SSD。`,
      );
    }
  } catch (error) {
    addCheck("storage.free", "fail", String(error), "无法读取 TART_HOME 所在卷容量。");
  }
}

if (tartPath && tartAncestor) {
  const listResult = run(tartPath, ["list", "--format", "json"], {
    env: { ...process.env, TART_HOME: tartHome },
  });
  if (listResult.status === 0) {
    let count = "unknown";
    try {
      count = JSON.parse(listResult.stdout).length;
    } catch {
      // A successful command with non-JSON output is still reported as a contract failure.
    }
    if (count === "unknown") {
      addCheck("tart.home", "fail", "tart list returned invalid JSON", "检查 Tart 安装和 TART_HOME。" );
    } else {
      addCheck("tart.home", "pass", `${count} local image(s)`);
    }
  } else {
    const detail = (listResult.stderr || listResult.stdout || "tart list failed").trim();
    addCheck("tart.home", "fail", detail, "确保 TART_HOME 可写且当前登录 Keychain 已解锁。" );
  }
}

const failures = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  ready: failures.length === 0,
  tartHome,
  summary: {
    passed: checks.filter((check) => check.status === "pass").length,
    warnings: warnings.length,
    failures: failures.length,
  },
  checks,
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of checks) {
    const marker = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`[${marker}] ${check.id}: ${check.detail}`);
    if (check.remediation) console.log(`       -> ${check.remediation}`);
  }
  console.log("");
  console.log(
    report.ready
      ? `P0 host preflight READY (${report.summary.passed} checks passed).`
      : `P0 host preflight BLOCKED (${report.summary.failures} failure(s), ${report.summary.warnings} warning(s)).`,
  );
}

process.exit(report.ready ? 0 : 1);
