#!/usr/bin/env node

/**
 * Setup script for the OpenDrSai presentations skill.
 *
 * Installs public-npm dependencies (sharp, skia-canvas, lucide) and links
 * the vendored @oai/artifact-tool package into node_modules.
 *
 * The @oai/artifact-tool package is NOT available on public npm. It is
 * vendored under vendor/@oai/artifact-tool/ and referenced in package.json
 * via the "file:" protocol so npm creates a symlink in node_modules.
 *
 * The vendored package may bundle platform-specific native binaries (e.g.
 * skia-canvas) built for a different OS.
 * This script removes any bundled skia-canvas so Node.js module resolution
 * falls back to the skill-level install (correct platform binary).
 *
 * Run this once after installing or updating the skill.
 *
 * Usage:
 *   node container_tools/setup_dependencies.mjs [--skill-dir path]
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--help" || k === "-h") { a.help = true; continue; }
    if (!k.startsWith("--")) continue;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) { a[k.slice(2)] = true; continue; }
    a[k.slice(2)] = v;
    i++;
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log([
    "Usage: node container_tools/setup_dependencies.mjs [--skill-dir path]",
    "",
    "  --skill-dir path  Skill root directory (default: auto-detected)",
  ].join("\n"));
  process.exit(0);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(args["skill-dir"] || path.join(scriptDir, ".."));
const packageJsonPath = path.join(skillDir, "package.json");
const nodeModulesDir = path.join(skillDir, "node_modules");
const vendoredPkg = path.join(skillDir, "vendor", "@oai", "artifact-tool", "package.json");

if (!fs.existsSync(packageJsonPath)) {
  console.error("No package.json found at " + packageJsonPath);
  process.exit(1);
}

// Step 1: Verify vendored @oai/artifact-tool
console.log("Checking vendored @oai/artifact-tool...");
if (!fs.existsSync(vendoredPkg)) {
  console.error(
    "\n[ERROR] @oai/artifact-tool is not vendored at:\n" +
    "  " + path.dirname(vendoredPkg) + "\n\n" +
    "This package is NOT available on public npm.\n" +
    "Obtain it from an internal source and place it under\n" +
    "  vendor/@oai/artifact-tool/\n" +
    "before running this script.",
  );
  process.exit(1);
}

const pkgInfo = JSON.parse(fs.readFileSync(vendoredPkg, "utf-8"));
console.log("  [OK] @oai/artifact-tool v" + pkgInfo.version + " found (vendored)");

const mainEntry = path.join(path.dirname(vendoredPkg), "dist", "artifact_tool.mjs");
if (!fs.existsSync(mainEntry)) {
  console.error("\n[ERROR] Vendored @oai/artifact-tool is missing dist/artifact_tool.mjs\n");
  process.exit(1);
}
console.log("  [OK] dist/artifact_tool.mjs entry point exists");

// Step 1b: Remove bundled skia-canvas (platform-specific native binary)
const bundledSkia = path.join(path.dirname(vendoredPkg), "node_modules", "skia-canvas");
if (fs.existsSync(bundledSkia)) {
  console.log("  Removing bundled skia-canvas (will use skill-level install)...");
  fs.rmSync(bundledSkia, { recursive: true, force: true });
  console.log("  [OK] Bundled skia-canvas removed");
}

// Step 2: Install all dependencies (npm will link file: vendored package)
console.log("\nInstalling dependencies in:\n  " + skillDir + "\n");
try {
  execSync("npm install --omit=dev --no-audit --no-fund", {
    cwd: skillDir,
    stdio: "inherit",
  });
  console.log("\n[OK] Dependencies installed successfully.");
} catch (error) {
  console.error("\n[ERROR] Failed to install dependencies:", error.message);
  process.exit(1);
}

// Step 3: Post-install verification
console.log("\nVerifying all dependencies...");

const checks = [
  { name: "@oai/artifact-tool", p: path.join(nodeModulesDir, "@oai", "artifact-tool", "package.json") },
  { name: "sharp", p: path.join(nodeModulesDir, "sharp", "package.json") },
  { name: "skia-canvas", p: path.join(nodeModulesDir, "skia-canvas", "package.json") },
  { name: "lucide (optional)", p: path.join(nodeModulesDir, "lucide", "package.json"), opt: true },
];

let allGood = true;
for (const c of checks) {
  if (fs.existsSync(c.p)) {
    const d = JSON.parse(fs.readFileSync(c.p, "utf-8"));
    console.log("  [OK] " + c.name + " v" + d.version);
  } else if (c.opt) {
    console.log("  [--] " + c.name + " - not installed (optional)");
  } else {
    console.error("  [FAIL] " + c.name + " - MISSING");
    allGood = false;
  }
}

if (!allGood) {
  console.error("\n[ERROR] Some required dependencies are missing.");
  process.exit(1);
}

console.log("\n[OK] All dependencies verified. The presentations skill is ready to use.");
