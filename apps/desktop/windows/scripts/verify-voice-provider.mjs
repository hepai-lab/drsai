import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const gateway = readFileSync(new URL("../../../../cores/python/packages/drsai/src/drsai/backend/gateway.py", import.meta.url), "utf8");
const voice = readFileSync(new URL("../src/main/voice.ts", import.meta.url), "utf8");
for (const expected of ["UploadFile", "httpx.AsyncClient", "Authorization", "/audio/transcriptions", "status_code=413", "status_code=504"]) {
  if (!gateway.includes(expected)) throw new Error(`Voice provider verification failed: ${expected}`);
}
for (const expected of ["providerHttpError", "auth_required", "rate_limited", "network_error", "readBoundedJson"]) {
  if (!voice.includes(expected)) throw new Error(`Voice provider verification failed: ${expected}`);
}
const repoRoot = resolve(new URL("../../../../", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const venvPython = resolve(repoRoot, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = existsSync(venvPython) ? venvPython : process.platform === "win32" ? "python" : "python3";
const result = spawnSync(python, [resolve(repoRoot, "apps/desktop/windows/scripts/verify_voice_provider.py")], {
  cwd: repoRoot,
  env: { ...process.env, PYTHONPATH: resolve(repoRoot, "cores/python/packages/drsai/src") },
  encoding: "utf8",
});
if (result.status !== 0) throw new Error(`Voice provider behavior verification failed:\n${result.stdout}\n${result.stderr}`);
process.stdout.write(result.stdout);
console.log("Voice provider verification passed.");
