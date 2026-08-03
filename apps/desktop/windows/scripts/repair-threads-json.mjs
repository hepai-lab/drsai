import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const desktopDir = join(process.env.DRSAI_HOME?.trim() || join(homedir(), ".drsai"), "desktop");
const threadsPath = join(desktopDir, "threads.json");
const snapshotsPath = join(desktopDir, "thread-snapshots.json");

function recoverJsonArray(raw) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "[" || c === "{") depth += 1;
    if (c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(raw.slice(0, i + 1));
    }
  }
  throw new Error("Could not recover JSON array from threads.json");
}

const raw = readFileSync(threadsPath, "utf8");
let threads;
try {
  threads = JSON.parse(raw);
  console.log("threads.json already valid,", threads.length, "threads");
} catch {
  threads = recoverJsonArray(raw);
  writeFileSync(threadsPath, `${JSON.stringify(threads, null, 2)}\n`, "utf8");
  console.log("repaired threads.json,", threads.length, "threads");
}

for (const thread of threads) {
  console.log("-", thread.id, thread.title, thread.workspacePath, "msgs=", thread.messageCount);
}

try {
  const snapshots = JSON.parse(readFileSync(snapshotsPath, "utf8"));
  console.log("snapshots ok,", Object.keys(snapshots).length, "entries");
} catch (error) {
  console.error("snapshots parse failed:", error instanceof Error ? error.message : error);
}
