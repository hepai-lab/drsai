import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const windowsRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sharedRoot = resolve(windowsRoot, "../shared");
const routeNames = ["serial", "streaming", "duplex"];
const routeRoots = [
  join(sharedRoot, "main", "voice"),
  join(sharedRoot, "renderer", "src", "voice"),
  join(windowsRoot, "src", "main", "voice"),
];

let checkedFiles = 0;
for (const routeRoot of routeRoots) {
  for (const route of routeNames) {
    const root = join(routeRoot, route);
    for (const file of walk(root)) {
      checkedFiles += 1;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)) {
        const specifier = match[2].replaceAll("\\", "/");
        for (const other of routeNames.filter((name) => name !== route)) {
          assert.ok(
            !new RegExp(`(?:^|/)voice/${other}(?:/|$)`).test(specifier),
            `${relative(windowsRoot, file)}: ${route} route must not import ${other} route internals (${specifier}).`,
          );
        }
      }
    }
  }
}

assert.ok(checkedFiles > 0, "Voice route boundary verifier did not inspect any files.");
console.log(`Voice route boundaries verified across ${checkedFiles} route files.`);

function walk(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(path))) files.push(path);
  }
  return files;
}
