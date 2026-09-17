#!/usr/bin/env node

// Helper used by ensure_raster_image.py to rasterize SVG/SVGZ through a
// locally configured Node + sharp installation instead of requiring Inkscape.

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key.slice(2)] = true;
      continue;
    }
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function requireArg(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required --${key}`);
  }
  return value;
}

const SKILL_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..");

function resolveSharp() {
  const searchDirs = [
    process.env.NODE_PATH,
    path.join(SKILL_DIR, "node_modules"),
    path.join(process.cwd(), "node_modules"),
  ].filter(Boolean);

  for (const dir of searchDirs) {
    try {
      const requireFromDir = createRequire(path.join(dir, "__runtime__.cjs"));
      return requireFromDir("sharp");
    } catch {
      // continue to next candidate
    }
  }
  throw new Error(
    [
      "Could not load the 'sharp' package.",
      "Install it in one of these ways:",
      "  npm install sharp   (inside the skill directory or project root)",
      "  set NODE_PATH to a node_modules directory containing sharp",
      "",
      `Searched: ${searchDirs.join(", ")}`,
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = path.resolve(requireArg(args, "input"));
  const output = path.resolve(requireArg(args, "output"));
  const sharp = resolveSharp();

  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp(input, { limitInputPixels: false }).png().toFile(output);
  console.log(JSON.stringify({ input, output }));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
