import { relative, resolve } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

// Explicit P9 implementation and acceptance boundary. Keeping this list
// narrow prevents unrelated Desktop feature work from invalidating Codex
// Adapter evidence while still binding every P9 production/test dependency.
export const CODEX_P9_SOURCE_PATHS = Object.freeze([
  "cores/protocol/codex-app-server-stable-contract.json",
  "cores/protocol/codex-app-server",
  "cores/python/packages/drsai/src/drsai/backend/codex_adapter",
  "cores/python/packages/drsai/src/drsai/backend/runtime/agent.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/agent_bindings.py",
  "cores/python/packages/drsai/src/drsai/backend/gateway.py",
  "cores/python/packages/drsai/tests/test_agent_backend_bindings.py",
  "cores/python/packages/drsai/tests/test_codex_backend_client.py",
  "cores/python/packages/drsai/tests/test_codex_jsonrpc_client.py",
  "cores/python/packages/drsai/tests/test_codex_run_finalizer.py",
  "cores/python/packages/drsai/tests/test_codex_stable_contract.py",
  "cores/python/packages/drsai/scripts/export_codex_app_server_schema.py",
  "cores/python/packages/drsai/scripts/generate_codex_stable_contract.py",
  "cores/python/packages/drsai/scripts/verify_codex_stable_contract.py",
  "apps/desktop/shared/api/desktopApi.ts",
  "apps/desktop/shared/main/diagnostics.ts",
  "apps/desktop/shared/main/legacyProtocolTelemetry.ts",
  "apps/desktop/shared/main/preload.ts",
  "apps/desktop/shared/main/runtimeClient.ts",
  "apps/desktop/shared/main/sessionHistorySync.ts",
  "apps/desktop/shared/main/sessionViewStore.ts",
  "apps/desktop/shared/main/threadRuntimeSubscription.ts",
  "apps/desktop/shared/renderer/src/App.tsx",
  "apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx",
  "apps/desktop/shared/renderer/src/styles.css",
  "apps/desktop/shared/renderer/src/threadPatchFrameBatcher.ts",
  "apps/desktop/shared/renderer/src/threadSnapshotCoordinator.ts",
  "apps/desktop/shared/renderer/src/threadSnapshotPatch.ts",
  "apps/desktop/shared/renderer/src/threadSnapshotStore.ts",
  "apps/desktop/shared/renderer/src/userFacingErrors.ts",
  "apps/desktop/windows/src/main/e2eSmoke.ts",
  "apps/desktop/windows/src/main/index.ts",
  "apps/desktop/macos/src/main/ipc/registerCatalogIpc.ts",
  "apps/desktop/windows/package.json",
  "apps/desktop/windows/scripts/codex-p9-evidence-policy.mjs",
  "apps/desktop/windows/scripts/codex-p9-source-scope.mjs",
  "apps/desktop/windows/scripts/generate-codex-p9-ledger.mjs",
  "apps/desktop/windows/scripts/run-codex-p9-live.mjs",
  "apps/desktop/windows/scripts/verify-codex-desktop-integration.mjs",
  "apps/desktop/windows/scripts/verify-codex-p9-evidence-contract.mjs",
  "apps/desktop/windows/scripts/verify-codex-p9-feature-ledger.mjs",
  "apps/desktop/windows/scripts/verify-codex-p9-release.mjs",
  "apps/desktop/windows/scripts/verify-p7-session-view-store.mts",
  "apps/desktop/windows/scripts/verify-p8-electron-ipc.mjs",
  "apps/desktop/windows/scripts/verify-p8-legacy-telemetry.mts",
  "apps/desktop/windows/scripts/verify-p8-removal-governance.mjs",
  "apps/desktop/windows/scripts/verify-p8-transactional-patch.mts",
  "apps/desktop/windows/scripts/verify-p9-real-incremental-patch.mts",
  "apps/desktop/windows/scripts/verify-p9-runtime-identity-and-hydration.mts",
  "apps/desktop/windows/scripts/verify-p9-ux-security.mts",
  "apps/desktop/windows/scripts/verify-structured-message-renderer.mjs",
  "apps/desktop/windows/scripts/verify-structured-quality.mjs",
  "apps/desktop/windows/scripts/verify-thread-patch-frame-batcher.mts",
]);

export function p9SourceEntries(root, planPath) {
  return [...CODEX_P9_SOURCE_PATHS.map((value) => resolve(root, value)), planPath];
}

export function p9GitDiffArgs(root, planPath) {
  return ["diff", "--binary", "--", ...CODEX_P9_SOURCE_PATHS,
    relative(root, planPath).replaceAll("\\", "/")];
}

export function discoverP9CodexBinary(root) {
  const explicit = process.env.CODEX_BIN;
  if (explicit && existsSync(explicit)) return resolve(explicit);
  const local = process.env.LOCALAPPDATA;
  const desktopRoot = local ? resolve(local, "OpenAI/Codex/bin") : "";
  if (desktopRoot && existsSync(desktopRoot)) {
    const candidates = readdirSync(desktopRoot).filter((name) => /^[0-9a-f]{8,64}$/i.test(name))
      .map((name) => resolve(desktopRoot, name, "codex.exe")).filter(existsSync)
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
    if (candidates[0]) return candidates[0];
  }
  const development = resolve(root, "apps/desktop/windows/node_modules/.bin/codex.cmd");
  return existsSync(development) ? development : undefined;
}

export function p9CodexDigestEntries(root, discovered) {
  const development = resolve(root, "apps/desktop/windows/node_modules/.bin/codex.cmd");
  return discovered === development ? [development,
    resolve(root, "apps/desktop/windows/node_modules/@openai/codex/bin/codex.js"),
    resolve(root, "apps/desktop/windows/node_modules/@openai/codex-win32-x64")] : discovered ? [discovered] : [];
}
