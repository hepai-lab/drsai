import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const windowsRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(windowsRoot, "../../..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");

const installer = read("scripts/install.ps1");
const launcherEntry = read("apps/desktop/windows-desktop-dev.cmd");
const launcher = read("apps/desktop/windows/scripts/dev.ps1");
const paths = read("apps/desktop/shared/main/desktopPaths.ts");
const app = read("apps/desktop/shared/renderer/src/App.tsx");
const workspaceShell = read("apps/desktop/shared/renderer/src/components/WorkspaceShell.tsx");
const auth = read("apps/desktop/shared/renderer/src/auth/AuthProvider.tsx");
const loginScreen = read("apps/desktop/shared/renderer/src/auth/LoginScreen.tsx");
const gateway = read("apps/desktop/shared/main/gateway.ts");
const runtimeClient = read("apps/desktop/shared/main/runtimeClient.ts");
const threadRuntimeSubscription = read("apps/desktop/shared/main/threadRuntimeSubscription.ts");
const workspaces = read("apps/desktop/shared/main/workspaces.ts");
const windowsMain = read("apps/desktop/windows/src/main/index.ts");
const developmentLaunchEnvironment = read("apps/desktop/windows/src/main/developmentLaunchEnvironment.ts");
const electronViteConfig = read("apps/desktop/windows/electron.vite.config.ts");
const rendererHtml = read("apps/desktop/shared/renderer/index.html");

assert.ok(installer.includes('Join-Path $InstallDir ".dev-source"'));
assert.ok(installer.includes("[System.IO.Directory]::Delete($installItem.FullName)"));
assert.ok(!installer.includes("-ItemType SymbolicLink"));
assert.ok(!installer.includes("mklink /J"));
assert.ok(installer.includes('$PackageDir = Join-Path $RepositorySource'));

assert.ok(!launcherEntry.includes("-WithGateway"));
assert.ok(launcherEntry.includes("%*"));

assert.ok(launcher.includes('$env:DRSAI_REPO = $RepoRoot'));
assert.ok(launcher.includes('$env:OPENDRSAI_RUNTIME_ROOT = $InstallDir'));
assert.ok(launcher.includes('Join-Path $env:USERPROFILE ".drsai-dev"'));
assert.ok(launcher.includes('[int]$GatewayPort = 28642'));
assert.ok(launcher.includes('$env:OPENDRSAI_ELECTRON_USER_DATA = $ElectronUserData'));
assert.ok(launcher.includes('$env:OPENDRSAI_DEV_HOME = $DrsaiHome'));
assert.ok(launcher.includes('$env:OPENDRSAI_DEV_GATEWAY_PORT = [string]$GatewayPort'));
assert.ok(launcher.includes('[string]$PipIndexUrl = "https://pypi.tuna.tsinghua.edu.cn/simple"'));
assert.ok(launcher.includes('$env:PIP_INDEX_URL'));
assert.ok(launcher.includes('$env:OPENDRSAI_DEV_PIP_INDEX_URL'));
assert.ok(launcher.includes("React/CSS hot module replacement"));
assert.ok(launcher.includes('node_modules\\@electron-toolkit\\utils\\package.json'));
assert.ok(launcher.includes('node_modules\\@electron-toolkit\\preload\\package.json'));
assert.ok(electronViteConfig.includes('host: "127.0.0.1"'));
assert.ok(rendererHtml.includes("ws://127.0.0.1:*"));
assert.ok(launcher.includes("FileAttributes]::ReparsePoint"));
assert.ok(launcher.includes("Remove-LegacyProductionDeveloperInstall"));
assert.ok(launcher.includes("Remove-LegacySourceWorkspaceRegistration"));
assert.ok(paths.includes("environment.OPENDRSAI_RUNTIME_ROOT?.trim() || repository"));

assert.ok(app.includes("defaultWorkspaceRegistrationRef"));
assert.ok(app.includes("workspaceRefreshPromiseRef"));
assert.ok(app.includes("chatChoicesPromiseRef"));
assert.ok(app.includes("matchedThreadWorkspace?.path"));
assert.ok(!app.includes("loadLegacyWorkspaces"));
assert.ok(app.includes('path: ""'));
assert.ok(app.includes("const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true);"));
assert.ok(workspaceShell.includes("useState(!rightPanelCollapsed)"));
assert.ok(workspaceShell.includes("if (!worktreeOpen) return;"));
assert.ok(workspaceShell.includes("if (!worktreeOpen || !activeWorkspace?.path) return;"));
assert.ok(auth.includes("bootstrapPromiseRef") && auth.includes("initialLoadPromiseRef"));
assert.ok(auth.includes("setLoginFailed(true)"));
const refreshAuthBody = auth.slice(auth.indexOf("function refresh()"), auth.indexOf("function retryBootstrap()"));
assert.ok(!refreshAuthBody.includes("retryBootstrap()"));
assert.ok(auth.includes('!serviceBlocker ||\n      serviceBlocker.kind !== "service_unavailable"'));
assert.ok(app.includes("const servicePreparing = !remotePlatformChatAvailable && (auth.serviceBusy || !auth.serviceReady);"));
assert.ok(app.includes("(remotePlatformChatAvailable || !auth.serviceBusy)"));
assert.ok(app.includes("if (!remotePlatformChatAvailable && !auth.serviceReady)"));
assert.ok(app.includes("const ready = await auth.retryBootstrap();"));
assert.ok(loginScreen.includes("登录失败，按F12调试。"));
assert.ok(loginScreen.includes('event.key !== "F12"'));

const healthProbe = gateway.slice(
  gateway.indexOf("async function probeGatewayEndpointsOnce"),
  gateway.indexOf("function isTcpPortOpen"),
);
assert.ok(healthProbe.includes("/health"));
assert.ok(!healthProbe.includes("/v1/models"));
assert.ok(runtimeClient.includes("for (const delayMs of [800, 1_200])"));
assert.ok(runtimeClient.includes("connectIfAvailable"));
assert.ok(runtimeClient.includes("connectRuntimeClientForWorkspaceIfAvailable"));
assert.ok(threadRuntimeSubscription.includes("connectRuntimeClientForWorkspaceIfAvailable"));
assert.ok(!threadRuntimeSubscription.includes("connectRuntimeClientForWorkspace,"));
assert.ok(workspaces.includes("LocalRuntimeClient.connectIfAvailable()"));
assert.ok(windowsMain.includes("[DRSAI_HOME, DRSAI_REPO]"));
assert.ok(windowsMain.includes('app.setPath("userData", resolve(configuredElectronUserData))'));
assert.ok(windowsMain.startsWith('import "./developmentLaunchEnvironment";'));
assert.ok(developmentLaunchEnvironment.includes('process.defaultApp === true'));
assert.ok(developmentLaunchEnvironment.includes('join(input.userHome, ".drsai-dev")'));
assert.ok(developmentLaunchEnvironment.includes('OPENDRSAI_GATEWAY_PORT: port'));
assert.ok(developmentLaunchEnvironment.includes('OPENDRSAI_DEEP_LINK_PROTOCOL: "opendrsai-dev"'));
assert.ok(windowsMain.includes('? "opendrsai-dev"'));
assert.ok(windowsMain.includes("isLocalRuntimeUnavailableError(error)"));

console.log("Developer install and default-workspace startup verification passed.");
