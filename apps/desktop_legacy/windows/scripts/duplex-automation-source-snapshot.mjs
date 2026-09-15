import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export const collectDuplexAutomationSources = (root) => {
  const workspace = resolve(root, "../../.."); const files = [];
  const walk = (path, accept = () => true) => { for (const name of readdirSync(path)) { const child = resolve(path, name); if (statSync(child).isDirectory()) walk(child, accept); else if (accept(child)) files.push(child); } };
  walk(resolve(root, "../shared/api")); walk(resolve(root, "../shared/main")); walk(resolve(root, "../shared/renderer/src/voice"));
  walk(resolve(root, "src")); walk(resolve(root, "scripts"), (path) => /duplex|voice-(?:route|mode|preferences)/i.test(path));
  for (const path of [
    resolve(root, "package.json"),
    resolve(workspace, "cores/python/packages/drsai/src/drsai/config/realtime_audio_adapter.py"),
    resolve(workspace, "cores/python/packages/drsai/src/drsai/backend/gateway.py"),
    resolve(workspace, "cores/python/packages/drsai/tests/test_realtime_audio_adapter.py"),
    resolve(workspace, "cores/python/packages/drsai/tests/test_realtime_audio_gateway.py"),
  ]) files.push(path);
  return [...new Set(files)].sort().map((path) => ({ path, relativePath: relative(workspace, path).replaceAll("\\", "/"), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
};

export const duplexAutomationSourceDigest = (root) => {
  const files = collectDuplexAutomationSources(root); return { fileCount: files.length, sha256: createHash("sha256").update(JSON.stringify(files.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })))).digest("hex") };
};
