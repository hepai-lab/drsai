import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const wix = read("../installers/windows/OpenDrSaiDesktopBootstrapper.wxs");
const sandbox = read("scripts/run-windows-sandbox-acceptance.ps1");
const matrix = read("scripts/invoke-m1-windows-sandbox-matrix.ps1");
const e2e = read("src/main/e2eSmoke.ts");
const gateway = read("scripts/m1-fake-gateway.py");

const checks = {
  perUserLimitedMsi: /InstallScope="perUser"[\s\S]*InstallPrivileges="limited"/.test(wix),
  localAppDataInstall: /LocalAppDataFolder[\s\S]*LocalProgramsFolder[\s\S]*INSTALLFOLDER/.test(wix),
  currentUserRegistration: /RegistryValue Root="HKCU"/.test(wix),
  noMachineInstallArgument: !/-MachineInstall/.test(wix),
  userImpersonatedCustomActions: (wix.match(/Execute="deferred" Impersonate="yes"/g) || []).length === 6
    && !/Execute="deferred" Impersonate="no"/.test(wix),
  noManualAcceptanceDialog: !/System\.Windows\.Forms|MessageBox|Manual OIDC/.test(sandbox),
  ordinaryAccountAsserted: /Ordinary non-elevated process/.test(sandbox),
  cleanPrerequisitesAsserted: ["node.exe", "python.exe", "git.exe"].every((name) => sandbox.includes(name)),
  lockedCernFixture: sandbox.includes("f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e")
    && sandbox.includes("WLCG-20260715-WLCG-talk-IHEP-visit.pdf"),
  installedAppUsed: /Start-Process -FilePath \$state\.desktopPath/.test(sandbox),
  authenticatedSessionAsserted: /Authenticated first-use session/.test(sandbox),
  firstScreenBudgetAsserted: /First interactive screen <=3 seconds/.test(sandbox),
  firstTaskBudgetAsserted: /First valid task <=3 minutes/.test(sandbox) && /TotalSeconds -le 180/.test(sandbox),
  generatedPptxAsserted: /Generated PPTX exists/.test(sandbox),
  resultsCenterAsserted: /First result indexed in G1 Results center/.test(sandbox),
  tenDisposableRunsSupported: /ValidateRange\(1, 10\)/.test(matrix) && /\[int\]\$Runs = 10/.test(matrix),
  isolatedSandboxMapping: /WindowsSandbox\.exe/.test(matrix) && /<MappedFolders>/.test(matrix) && /<ReadOnly>true<\/ReadOnly>/.test(matrix),
  matrixRequiresAllRuns: /passedRuns[\s\S]*-eq \$Runs/.test(matrix),
  rendererTimesFirstScreen: /firstInteractiveScreenWithinThreeSeconds/.test(e2e),
  rendererVerifiesAuthenticatedSession: /authenticatedUserSessionVisible/.test(e2e),
  rendererReopensFirstResult: /firstResultIndexedInResultsCenter/.test(e2e) && /firstResultOpensFromResultsCenter/.test(e2e),
  deterministicLocalGateway: /ThreadingHTTPServer\(\("127\.0\.0\.1", port\)/.test(gateway)
    && !/requests|urllib\.request|http\.client/.test(gateway),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`M1 clean-install contract failed: ${failed.join(", ")}`);
console.log(JSON.stringify({ ok: true, checks, count: Object.keys(checks).length }, null, 2));
