import { spawnSync } from "node:child_process";

run("scripts/verify-windows-signing-evidence.mjs");
run("scripts/verify-release-readiness.mjs", {
  REQUIRE_RELEASE_READY: "1",
  REQUIRE_SIGNED_WINDOWS_ARTIFACTS: "1",
  SKIP_PUBLIC_RELEASE_CHECK: "0",
});
console.log("Windows public release gate passed with trusted Authenticode evidence and published assets.");

function run(script, extraEnv = {}) {
  const result = spawnSync(process.execPath, [script], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
