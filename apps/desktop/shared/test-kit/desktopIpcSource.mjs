import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export function macosIpcSource(desktopRoot) {
  const paths = [resolve(desktopRoot, "macos/src/main/index.ts")];
  const ipcRoot = resolve(desktopRoot, "macos/src/main/ipc");
  for (const entry of readdirSync(ipcRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) paths.push(join(ipcRoot, entry.name));
  }
  return paths.sort().map((path) => readFileSync(path, "utf8")).join("\n");
}
