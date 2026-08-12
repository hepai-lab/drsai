import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), "utf8");
const builder = read("electron-builder.yml");
const packageJson = JSON.parse(read("package.json"));
const updater = read("src/main/updater.ts");
const updateFeedPolicy = read("src/main/updateFeedPolicy.ts");
const updateFeedVerifier = read("scripts/verify-update-feed-policy.mts");
const promotionPolicy = read("scripts/update-promotion-policy.mjs");
const promotionVerifier = read("scripts/verify-update-promotion-policy.mjs");
const ossPublisher = read("scripts/publish-update-to-oss.mjs");
const publishedVerifier = read("scripts/verify-published-update.mjs");
const websiteReleaseVerifier = read("scripts/verify-website-release.mjs");
const thinPackageVerifier = read("scripts/verify-thin-update-package.mjs");
const metadataAnnotator = read("scripts/annotate-update-metadata.mjs");
const runtimeInstaller = read("src/main/runtimeInstaller.ts");
const runtimeBuilder = read("scripts/build-runtime-artifact.sh");
const runtimeNotarizationSigner = read("scripts/sign-runtime-for-notarization.mjs");
const adhocHook = read("scripts/after-pack.cjs");
const nativePermissionsHook = read("scripts/after-pack-native-permissions.cjs");
const updatePackHook = read("scripts/after-pack-update.cjs");
const updateBuilder = read("electron-builder.update.yml");
const bootstrapEntry = read("src/main/bootstrapEntry.ts");
const browserRuntimeLock = read("resources/runtime/browser-requirements.lock");
const runtimeLock = read("resources/runtime/runtime-requirements.lock");
const macMain = read("src/main/index.ts");
const trustIpc = read("src/main/ipc/registerTrustIpc.ts");
const appServices = read("src/main/bootstrap/createAppServices.ts");
const nativeBuild = read("native/OpenDrSaiNativeHelper/build-debug.sh");
const macWindow = read("src/main/bootstrap/createWindow.ts");
const packagedSmoke = read("scripts/verify-packaged-smoke.mjs");
const packagedL5 = read("scripts/verify-packaged-l5.mjs");
const sleepWakeDevice = read("scripts/verify-sleep-wake-real-device.mjs");
const releaseL6 = read("scripts/verify-release-l6.mjs");
const dmgNotarizer = read("scripts/notarize-dmg.mjs");
const tccL6 = read("scripts/verify-tcc-real-device.mjs");
const onlineUpdateL6 = read("scripts/verify-online-signed-update.mjs");
const updateWatchdog = read("resources/update/update-watchdog.sh");
const desktopRoot = resolve(root, "..");
const workflow = readFileSync(resolve(desktopRoot, "../../.github/workflows/macos-desktop.yml"), "utf8");
const gateway = readFileSync(resolve(root, "../../../cores/python/packages/drsai/src/drsai/backend/gateway.py"), "utf8");
const updateRunbook = read("docs/macos-update-production-runbook.zh-CN.md");

assert.ok(releaseL6.includes('const appExecutable = join(app, "Contents", "MacOS", "OpenDrSai")'), "L6 receipts must hash the App executable instead of reading the App directory.");
assert.ok(releaseL6.includes("sha256(appExecutable)"), "L6 receipts must bind to the App executable digest.");
assert.equal(releaseL6.includes("sha256(app)"), false, "L6 must not pass an App directory to readFileSync-based hashing.");

for (const path of ["build/entitlements.mac.plist", "build/entitlements.mac.inherit.plist"]) {
  assert.ok(existsSync(resolve(root, path)), `missing macOS entitlement file: ${path}`);
  const source = read(path);
  assert.ok(source.includes("com.apple.security.cs.allow-jit"));
  assert.equal(source.includes("com.apple.security.app-sandbox"), false, "sandbox must not be claimed before runtime compatibility is proven");
}
assert.equal(read("build/entitlements.mac.plist").includes("disable-library-validation"), false, "Release entitlements must preserve library validation.");
assert.ok(read("build/entitlements.mac.unsigned-development.plist").includes("disable-library-validation"), "Only unsigned development sealing may disable library validation.");
assert.ok(builder.includes("afterSign: scripts/after-pack.cjs"), "Ad-hoc sealing must run after Electron fuse mutation.");
assert.ok(builder.includes("afterPack: scripts/after-pack-native-permissions.cjs"), "Native executable permissions must be normalized before signing.");
assert.ok(nativePermissionsHook.includes("chmodSync(helper, 0o755)"), "node-pty spawn helper must be executable before signing.");
for (const contract of ['CSC_IDENTITY_AUTO_DISCOVERY !== "false"', '"--deep", "--sign", "-"', '"--verify", "--deep", "--strict"', 'identity: "adhoc"', "releaseIdentity: false"]) assert.ok(adhocHook.includes(contract), `Unsigned sealing hook omits ${contract}`);
for (const contract of ["OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE", 'app.setPath("userData"', 'appendSwitch("use-mock-keychain")', 'process.once("unhandledRejection"']) assert.ok(bootstrapEntry.includes(contract), `Acceptance bootstrap omits ${contract}`);
for (const contract of ["hardenedRuntime: true", "notarize: true", "target: dmg", "target: zip", "arch: arm64", "onlyLoadAppFromAsar: true"]) {
  assert.ok(builder.includes(contract), `macOS builder contract omits ${contract}`);
}
for (const contract of ["../shared/browser-use-worker", "to: browser-use-worker", '"*.py"', "requirements.txt"]) {
  assert.ok(builder.includes(contract), `macOS builder omits Browser worker resource contract: ${contract}`);
}
for (const contract of ["native/OpenDrSaiNativeHelper/.build/debug", "to: native", "OpenDrSaiNativeHelper", "libOpenDrSaiNativeProtocol.dylib"]) assert.ok(builder.includes(contract), `macOS builder omits Native Helper resource contract: ${contract}`);
for (const contract of ["arm64-apple-macosx11.0", "xcrun --sdk macosx --show-sdk-path", "xcrun --find swiftc", "OpenDrSaiNativeHelper", "-emit-library", 'lib${MODULE}.dylib']) assert.ok(nativeBuild.includes(contract), `Native Helper reproducible Debug build omits ${contract}`);
assert.ok(packageJson.scripts["build:mac:dir"]?.includes("build:native-helper") && packageJson.scripts["test:native-helper"], "macOS package scripts must build and test the Native Helper before packaging");
for (const path of ["../shared/browser-use-worker/worker.py", "../shared/browser-use-worker/protocol.py", "../shared/browser-use-worker/requirements.txt"]) {
  assert.ok(existsSync(resolve(root, path)), `missing shared Browser worker resource: ${path}`);
}
assert.ok(packageJson.scripts["build:mac:arm64"]?.includes("electron-builder"));
assert.ok(packageJson.scripts["build:mac:arm64"]?.includes("notarize:dmg"), "Release build must notarize and staple the completed DMG.");
for (const contract of ["notarytool", 'submission.status, "Accepted"', '"stapler", "staple"', '"stapler", "validate"', "dmg-notarization.json"]) assert.ok(dmgNotarizer.includes(contract), `DMG notarizer omits ${contract}`);
assert.ok(packageJson.devDependencies["electron-builder"]);
assert.ok(packageJson.dependencies["electron-updater"]);
assert.ok(packageJson.devDependencies.c8, "coverage runner dependency must be pinned in the macOS workspace");
assert.equal(packageJson.scripts["verify:coverage"], "node ../shared/test-kit/run-macos-shared-coverage.mjs");
assert.ok(packageJson.scripts.verify.indexOf("verify:coverage") >= 0 && packageJson.scripts.verify.indexOf("verify:coverage") < packageJson.scripts.verify.indexOf("verify:acceptance"), "coverage evidence must run before final feature acceptance");
for (const contract of ["checkForUpdates", "downloadUpdate", "CancellationToken", "quitAndInstall", "update-downloaded", "allowDowngrade = false"]) {
  assert.ok(updater.includes(contract), `macOS updater omits ${contract}`);
}
for (const contract of ["provider: generic", "https://download-opendrsai.ihep.ac.cn/channels/stable/macos/arm64/", "channel: latest"]) {
  assert.ok(builder.includes(contract), `macOS builder CDN feed omits ${contract}`);
}
assert.equal(builder.includes("provider: github"), false, "The packaged macOS app must prefer the production CDN rather than GitHub.");
for (const contract of ["MACOS_UPDATE_CDN_URL", "MACOS_UPDATE_GITHUB_OWNER", "MACOS_UPDATE_GITHUB_REPO", "validateFallbackCandidate", "source: \"github\"", "fallbackUsed: true", "macos-update-sources-failed", "macos-update-download-sources-failed"]) {
  assert.ok(`${updater}\n${updateFeedPolicy}`.includes(contract), `macOS CDN/GitHub fallback contract omits ${contract}`);
}
for (const contract of ["http://", "user:secret@", "selected CDN version", "digests differ"]) assert.ok(updateFeedVerifier.includes(contract), `Unsigned update policy verifier omits ${contract}`);
assert.ok(packageJson.scripts["verify:update-feed:unsigned"], "macOS package omits the unsigned update feed gate");
for (const contract of ["signed-l6", "verify-cdn-assets", "promote-stable-metadata", "verify-production-assets", "productionPromotionBlocked: true"]) {
  assert.ok(`${promotionPolicy}\n${promotionVerifier}`.includes(contract), `macOS promotion order gate omits ${contract}`);
}
assert.ok(packageJson.scripts["verify:update-promotion:unsigned"], "macOS package omits the unsigned promotion order gate");
for (const contract of ["--preflight", "--assets-only", "--promote-metadata", "--snapshot-stable", "--rollback-metadata", 'withConfig(["stat", target])', "OPENDRSAI_OSSUTIL_CONFIG", "Immutable OSS object already exists", "Unable to prove immutable OSS object is absent", '"--force", "--meta"', 'runRaw(["rm", stableTarget, "--force"])', "channels/history/macos/arm64", "channels/rollback/macos/arm64", "max-age=31536000, immutable", "max-age=30, must-revalidate"]) {
  assert.ok(ossPublisher.includes(contract), `macOS OSS publisher omits ${contract}`);
}
for (const contract of ["--head", '"--range", "0-1"', "content-range", "sha256", "OSS/CDN assets are byte-identical", "--pre-promotion", "--metadata-only"]) {
  assert.ok(publishedVerifier.includes(contract), `macOS published-origin verifier omits ${contract}`);
}
assert.ok(ossPublisher.includes('const versionPrefix = `releases/v${version}/macos`;'), "macOS OSS publisher must use the canonical release archive prefix.");
for (const verifier of [publishedVerifier, websiteReleaseVerifier]) {
  assert.ok(verifier.includes('`releases/${tag}/macos/${'), "macOS production verifier must use the canonical release archive prefix.");
  assert.equal(verifier.includes('`releases/${tag}/macos/arm64/'), false, "macOS production verifier must not add a directory-level architecture segment when filenames already contain the architecture.");
}
for (const contract of ["--origin", "--download-origin", "--release-dir", "latest-mac.yml", "opendrsaiRuntimeVersion", "remote-local-byte-identity", '"stapler", "validate"', '"--assess", "--type", "execute"', "website-release.json"]) {
  assert.ok(websiteReleaseVerifier.includes(contract), `macOS website release verifier omits ${contract}`);
}
for (const contract of ["macos-production-release", "Verify OSS CLI and publication credentials", "--preflight", "--assets-only", "Verify staged OSS/CDN byte identity", "Snapshot current stable metadata", "--snapshot-stable", "--promote-metadata", "Verify stable metadata", "--rollback-metadata"]) {
  assert.ok(workflow.includes(contract), `macOS production publication workflow omits ${contract}`);
}
for (const forbidden of ["gh release create", "gh release edit", "GitHub draft byte identity"]) assert.equal(workflow.includes(forbidden), false, `OSS-only workflow must not require ${forbidden}`);
assert.ok(packageJson.scripts["verify:update-publish-plan"] && packageJson.scripts["publish:update:oss"] && packageJson.scripts["verify:update-published"] && packageJson.scripts["verify:website-release"], "macOS package omits production distribution commands");
for (const contract of ["macos-production-release", "OPENDRSAI_OSSUTIL_BIN", "Developer ID Application", "previousExists=false", "--rollback-metadata", "opendrsaiRuntimeSha256", "production-promotion-blocked"]) assert.ok(updateRunbook.includes(contract), `macOS update production runbook omits ${contract}`);
for (const contract of ["scheduleUpdateHealthConfirmation", "minimum = acceptance ? 1_000 : 30_000", "configureSignedUpdateLabFeed", 'url.protocol !== "https:"', "url.hostname !== expectedHost"]) {
  assert.ok(`${updater}\n${updateFeedPolicy}`.includes(contract), `macOS updater health/lab policy omits ${contract}`);
}
for (const contract of ["scheduleUpdateHealthConfirmation()", "onRendererGone:"]) {
  assert.ok(macMain.includes(contract), `macOS update health orchestration omits ${contract}`);
}
for (const contract of ['window.webContents.on("render-process-gone"', 'window.on("unresponsive"', "cancelUpdateHealthConfirmation();"]) {
  assert.ok(macWindow.includes(contract), `macOS window update health cancellation omits ${contract}`);
}
for (const contract of ["prepareRollback", '"/usr/bin/ditto"', "update-watchdog.sh", "markUpdateHealthy", "expectedVersion"]) {
  assert.ok(updater.includes(contract), `macOS updater rollback omits ${contract}`);
}
for (const contract of ["kill -0", "EXPECTED_VERSION", "MAX_ATTEMPTS", "grep -Fq", "failed-update", "/usr/bin/ditto", "/usr/bin/open"]) {
  assert.ok(updateWatchdog.includes(contract), `macOS update watchdog omits ${contract}`);
}
for (const contract of ["sha256", "runtime-manifest.json", '"/usr/bin/tar"', '"import drsai"', ".previous", "rename(candidate, DRSAI_REPO)"]) {
  assert.ok(runtimeInstaller.includes(contract), `macOS Runtime installer omits ${contract}`);
}
for (const contract of ["afterPack: scripts/after-pack-update.cjs", "target: zip"]) assert.ok(updateBuilder.includes(contract), `Thin update builder omits ${contract}`);
for (const contract of ["normalizeNativePermissions", 'name.endsWith(".tar.gz")', "rmSync", "runtime-manifest.json", "Thin update package still contains"]) assert.ok(updatePackHook.includes(contract), `Thin update packaging hook omits ${contract}`);
for (const contract of ["readFileSync(bundledRuntimeManifestPath()", "isSafeRelativePath(manifest.archive)", "existsSync(resolveResource"]) assert.ok(runtimeInstaller.includes(contract), `Thin update Runtime availability policy omits ${contract}`);
assert.match(runtimeNotarizationSigner, /new Set\(matches\)/, "Runtime signing identity discovery must deduplicate identical certificate hashes returned through multiple keychain paths.");
assert.match(dmgNotarizer, /runWithRetry[\s\S]*stapler[\s\S]*2 \*\* \(attempt - 1\)/, "DMG stapling must retry transient Apple ticket-delivery failures with bounded exponential backoff.");
assert.ok(read("scripts/verify-update-assets.mjs").includes("2 * 1024 * 1024 * 1024"), "Update asset gate must enforce GitHub's 2 GiB per-file limit");
for (const contract of ["Runtime compatibility metadata", 'manifest.archive.endsWith(".tar.gz")', "bundled archive absent by design", "64 * 1024 * 1024"]) assert.ok(thinPackageVerifier.includes(contract), `Thin update package verifier omits ${contract}`);
assert.ok(packageJson.scripts["verify:update-thin-package"], "macOS package omits thin update structure verification");
assert.ok(metadataAnnotator.includes('--compatible-runtime-manifest'), "Update metadata annotation cannot target the persisted Runtime required by a thin update");
for (const contract of ["opendrsaiRuntimeVersion", "opendrsaiRuntimeSha256", "runtime-manifest.json"]) assert.ok(metadataAnnotator.includes(contract), `Update metadata annotator omits ${contract}`);
for (const contract of ["runtimeCompatibleWith", "inspectInstalledRuntime", "macos-update-runtime-incompatible", "Install the full DMG", "archiveSha256"]) assert.ok(`${updater}\n${updateFeedPolicy}`.includes(contract), `Updater Runtime compatibility gate omits ${contract}`);
assert.ok(packageJson.scripts["annotate:update-metadata"], "macOS package omits Runtime metadata annotation");
for (const contract of ["OPENDRSAI_RUNTIME_PYTHON", 'EXPECTED_PYTHON="3.11.9"', "pip install", "shasum -a 256", 'uname -m']) {
  assert.ok(runtimeBuilder.includes(contract), `macOS Runtime artifact builder omits ${contract}`);
}
for (const contract of ["browser-requirements.lock", "browser-venv", "--require-hashes", "PLAYWRIGHT_BROWSERS_PATH", "playwright install chromium", "browserPython", "browserPath"]) {
  assert.ok(runtimeBuilder.includes(contract), `macOS Browser Runtime builder omits ${contract}`);
}
for (const contract of ["browser-use==0.13.6", "playwright==", "pyobjc-core==", "pyobjc-framework-cocoa=="]) {
  assert.ok(browserRuntimeLock.includes(contract), `macOS Browser Runtime lock omits ${contract}`);
}
assert.equal(browserRuntimeLock.includes("pywin32=="), false, "macOS Browser Runtime lock must not contain the Windows-only pywin32 package");
assert.equal(runtimeLock.includes("pywin32=="), false, "macOS Runtime lock must not contain the Windows-only pywin32 package");
for (const contract of ["browser-venv", "browser-browsers", "PLAYWRIGHT_BROWSERS_PATH", "OPENDRSAI_BROWSER_USE_PYTHON"]) {
  assert.ok(appServices.includes(contract), `macOS Browser Runtime launch omits ${contract}`);
}
assert.ok(macMain.includes("appServices = createMacosAppServices"), "macOS Browser Runtime services must be created after app readiness");
for (const contract of ['channel === "desktop:git-commit-approval"', 'channel === "desktop:propose-approval"', "deduplicate: false"]) {
  assert.ok(macMain.includes(contract), `Mutable approval proposal IPC must bypass completed-response caching: ${contract}`);
}
assert.ok(trustIpc.includes("executeLocalGitCommit(request, allowed, approval.id)"), "Approved Git commits must carry their persistent approval id into the commit trailer.");
for (const contract of ["listRuntimeWorktrees", "assertManagedFork", 'item.status === "active"', "realpath(owned.canonicalPath)", "assertForkAllowed: assertManagedFork"]) {
  assert.ok(trustIpc.includes(contract), `Fork approvals and dispatch must verify Runtime-managed worktree ownership: ${contract}`);
}
for (const contract of ["OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE", "OPENDRSAI_MACOS_PTY_OK", "renderer/preload/IPC", "child.exitCode"]) {
  assert.ok(packagedSmoke.includes(contract), `macOS packaged smoke omits ${contract}`);
}
for (const contract of ["packaged-core-journeys", "packaged-product-journeys", "thread-crud-snapshot-search-archive-binding", "chat-start-abort-journal-late-input", "agent-catalog-default-usage-start-abort-recovery", "OPENDRSAI_DEV_AUTH_BYPASS", "OPENDRSAI_E2E_AUTH_USER_ID", "OPENDRSAI_PLATFORM_AGENTS_ENABLED", "git-approval-execute-and-replay", "workspace-git-diff-stage-ref-revert-stale-review", "checkpoint-create-preview-approved-restore-accept", "worktree-create-event-queue-dispatch-abort-discard", "ide-context-native-icon-edit-command-pdf-launchservices", "handoff-source.ts", "ide-context.json", "handoff.pdf", "minimalPdf", "startxref", "git-action.txt", "OpenDrSai-Approval:", "rev-list", "rejected-after-crash.txt", "approvalRecoveredAfterCrash", "recoveredApprovalRejected", "rejectedApprovalCommits", "rejectedChangeRemainedStaged", "custom-command-crud", "project-memory-crud", "project-skill-draft-approval-install", "workflow-marketplace-strict-completion-history", "reusable-task-fresh-input-and-scheduled-safe-due", "background-task-idempotency-cancel-retry", "debug-policy-attach-detach", "managed-process-crash", "managed-process-crash-recovery", "nativeHelperForcedCrashes", "gatewayForcedCrashes", "performance-ready", "packaged-performance-budget", "coldInteractiveBudgetMs", "warmInteractiveP95BudgetMs", "idleAverageCpuBudgetPercent", "idleMaxRssBudgetKiB", "restart-stability", "packaged-resource-sampling", '"/bin/ps"', '"/usr/sbin/lsof"', '"pid=,ppid=,rss=,time=,command="', "formalHundredRestartBudgetSatisfied", "summarizeRestartGrowth", "rssSlopeKiBPerIteration", "fdSlopePerIteration", "iterations === 100", "residualProcessCount", "fault-injection", "SIGKILL", "OPENDRSAI_MACOS_L5_RESTART_ITERATIONS", "OPENDRSAI_MACOS_L5_STABILITY_MS"]) {
  assert.ok(packagedL5.includes(contract), `macOS packaged L5 omits ${contract}`);
}
for (const contract of ["OPENDRSAI_MACOS_APP_PATH", "hasRuntimeArchive", '"/usr/bin/hdiutil"', '"attach"', '"detach"', "OpenDrSai-macOS-v"]) {
  assert.ok(packagedL5.includes(contract), `macOS packaged L5 full-DMG selection omits ${contract}`);
}
for (const contract of ['scenario === "managed-process-crash"', 'process.kill(helperBefore.pid, "SIGKILL")', 'process.kill(gatewayBefore.pid, "SIGKILL")', "Native Helper did not recover after SIGKILL", "Gateway restart did not produce a new healthy PID"]) {
  assert.ok(read("src/main/packagedSmoke.ts").includes(contract), `Packaged managed-process recovery omits ${contract}`);
}
for (const contract of ["sleep-wake", "lock-screen", "unlock-screen", "allExpectedEventsObserved", "eventOrderValid", "gatewayAfter.ready"]) {
  assert.ok(read("src/main/packagedSmoke.ts").includes(contract), `Packaged real-device lifecycle scenario omits ${contract}`);
}
for (const contract of ["Apple Silicon macOS hardware", "Put this Mac to sleep", "waitForNoResiduals", "residualProcessCount: 0", "sleep-wake-real-device.json", 'featureIds: ["F06.4", "F06.5", "F08.5", "F10.3"]']) {
  assert.ok(sleepWakeDevice.includes(contract), `macOS real-device sleep/wake verifier omits ${contract}`);
}
for (const contract of ["OPENDRSAI_MACOS_SLEEP_WAKE_ROUNDS", "formalTwentyRoundRequirementSatisfied", "scheduleAutomaticWakeAndSleep", "userDataSha256Before", "userDataSha256After"]) {
  assert.ok(sleepWakeDevice.includes(contract), `macOS formal sleep/wake matrix omits ${contract}`);
}
for (const contract of ["verify:v1.5.7:source", "verify:v1.5.7:electron", "verify:v1.5.7:device", "verify:v1.5.7:packaged", "verify:v1.5.7:update", "verify:v1.5.7:release", "verify:v1.5.7:all", "record:stability-matrix"]) {
  assert.ok(packageJson.scripts[contract], `macOS package scripts omit ${contract}`);
}
for (const contract of ["OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE", "OPENDRSAI_DEV_AUTH_BYPASS", 'x-opendrsai-auth-mode") == "offline"', 'request.user_id == "packaged-l5-user"', 'fixture_request_id == "packaged_chat_recovery_001"', "network_retry_attempt", "resume_from_chars", "X-OpenDrSai-Packaged-Recovery-Fixture"]) {
  assert.ok(gateway.includes(contract), `Packaged Chat recovery fixture omits security or cursor contract: ${contract}`);
}
assert.ok((gateway.match(/packaged_recovery_fixture = \(/g) ?? []).length >= 2, "Both legacy Chat SSE and Runtime execute endpoints must gate the packaged recovery fixture.");
for (const contract of ["--deep", "--strict", "Developer ID Application:", "spctl", "stapler", "hdiutil", "clean-install", "signed-update-rollback-rehearsal", "onlineUpdateInstalled: false", "userDataPreserved: true"]) {
  assert.ok(releaseL6.includes(contract), `macOS automated L6 omits ${contract}`);
}
for (const contract of ["OPENDRSAI_MACOS_PACKAGED_SCENARIO", '"tcc"', "microphoneState", "automationState", "notificationShowEventObserved", "hardwareIdentitySha256"]) {
  assert.ok(tccL6.includes(contract), `macOS real-device TCC L6 omits ${contract}`);
}
for (const contract of ["https:", "online-signed-update", "sourceSnapshot.commit", "sourceSnapshot.aggregateSha256", "onlineUpdateInstalled: true", "healthConfirmed: true", "userDataPreserved: true", "installedAppExecutableSha256", "codesign"] ) {
  assert.ok(onlineUpdateL6.includes(contract), `macOS signed online update L6 omits ${contract}`);
}
for (const contract of ["runtime-bootstrap.json", "OPENDRSAI_MACOS_L6_RUNTIME_BOOTSTRAP_APP", "runtimeBootstrapVersion", "runtimeBootstrapUsedPreviousApp", 'OPENDRSAI_MACOS_PACKAGED_SCENARIO: "smoke"', "waitForVersion", "--user-data-dir=", 'spawnSync("/usr/bin/pkill"']) {
  assert.ok(onlineUpdateL6.includes(contract), `macOS signed online update L6 does not initialize a compatible persisted Runtime: ${contract}`);
}
for (const contract of ["value?.ok === false", 'typeof value?.error === "string"', "online update scenario failed"]) assert.ok(onlineUpdateL6.includes(contract), `macOS signed online update L6 omits fail-fast handling: ${contract}`);
for (const contract of ['scenario === "tcc"', 'requestSystemPermission("microphone")', 'requestSystemPermission("automation")', 'requestSystemPermission("notifications")', 'openSystemPermissionSettings("files")']) {
  assert.ok(read("src/main/packagedSmoke.ts").includes(contract), `macOS packaged TCC scenario omits ${contract}`);
}
for (const contract of ['scenario === "product-state"', "login", "listAgents", "setDefaultAgent", "recordAgentUsage", "startChat", "cancelChatTurn", "recoverChatRun", "respondChatInput", "onChatEvent", "startAgentRun", "abortAgentRun", "recoverAgentRun", "onAgentRunEvent", "createThread", "updateThreadSnapshot", "searchThreadMessages", "setThreadArchived", "deleteThread", "requestGitCommitApproval", "getWorkspaceGitDiff", "stageWorkspaceFile", "getWorkspaceGitFileAtRef", "revertWorkspaceFile", "createWorkspaceCheckpoint", "listWorkspaceCheckpoints", "previewWorkspaceCheckpoint", "restoreWorkspaceCheckpoint", "acceptWorkspaceCheckpoint", "prepareForkWorktree", "listWorktrees", "listWorktreeEvents", "requestForkQueueStartApproval", "dispatchForkQueue", "worktreeBecameIdle", "requestForkLifecycleApproval", "getIdeContext", "getFileIcon", "performEditCommand", "openPdfPage", "upsertCustomCommand", "addProjectMemory", "createProjectSkillDraft", "installProjectSkillDraft", "listPendingApprovals", "decideApproval", "listWorkflowMarketplace", "prepareWorkflowRun", "startWorkflowRun", "dispatchWorkflowRunStep", "completeWorkflowRunStep", "listWorkflowRuns", "saveReusableTask", "prepareReusableTaskRun", "listReusableTasks", "createScheduledTask", "listScheduledTasks", "runDueScheduledTasks", "duplicateDueResult", "updateScheduledTask", "recordDiagnostic", "enqueueBackgroundTask", "updateBackgroundTask", "cancelBackgroundTask", "retryBackgroundTask", "updateInteractiveDebugPolicy", "startInteractiveDebugSession", 'action: "disconnect"']) {
  assert.ok(read("src/main/packagedSmoke.ts").includes(contract), `macOS packaged product-state scenario omits ${contract}`);
}
for (const contract of ["tags: [\"v*\"]", 'cron: "0 16 * * *"', "generate-source-snapshot.mjs --require-clean", "verify:runtime-reproducibility", "record:l4-evidence", "record:l5-evidence", "verify:packaged:l5", "--require-l4 --require-l5", "release-macos-l6-real-device", "self-hosted, macOS, ARM64, opendrsai-release", "verify:release:l6-auto", "stage:update-lab-feed", "verify:online-update:l6", "record:signed-update-evidence", "verify:tcc:l6", "record:l6-evidence", "--require-l4 --require-l5 --require-l6", "macos/build/acceptance/**"]) {
  assert.ok(workflow.includes(contract), `macOS CI evidence workflow omits ${contract}`);
}
assert.ok(workflow.indexOf("record:l6-evidence") < workflow.indexOf("Publish only after all L0-L6 gates pass"), "release publication must occur only after L6 evidence is recorded");
for (const path of [
  "../shared/test-kit/generate-source-snapshot.mjs",
  "../shared/test-kit/verify-macos-platform-evidence.mjs",
  "../shared/test-kit/record-macos-platform-evidence.mjs",
  "scripts/verify-runtime-reproducibility.mjs",
  "scripts/verify-packaged-l5.mjs",
  "scripts/verify-sleep-wake-real-device.mjs",
  "scripts/verify-keychain-lock-cycle.mjs",
  "scripts/record-v157-acceptance.mjs",
  "scripts/run-v157-acceptance.mjs",
  "../shared/test-kit/record-macos-l5-evidence.mjs",
  "../shared/test-kit/record-macos-stability-matrix.mjs",
  "scripts/verify-release-l6.mjs",
  "scripts/verify-tcc-real-device.mjs",
  "scripts/verify-online-signed-update.mjs",
  "scripts/stage-update-lab-feed.mjs",
  "scripts/prepare-previous-release.mjs",
  "../shared/test-kit/record-macos-signed-update-evidence.mjs",
  "../shared/test-kit/record-macos-l6-evidence.mjs",
]) assert.ok(existsSync(resolve(root, path)), `missing macOS evidence tool: ${path}`);
console.log("macOS release contract passed (arm64 DMG/ZIP, hardened runtime, entitlements, notarization, ASAR-only loading).");
