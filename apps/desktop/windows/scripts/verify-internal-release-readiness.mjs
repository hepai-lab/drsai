import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["scripts/verify-release-readiness.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    REQUIRE_RELEASE_READY: "1",
    REQUIRE_SIGNED_WINDOWS_ARTIFACTS: "0",
    SKIP_PUBLIC_RELEASE_CHECK: "1",
  },
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
