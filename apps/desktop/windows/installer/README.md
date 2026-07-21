# OpenDrSai Windows Installer

`contract/` 保存当前 Windows Runtime manifest schema、示例和安装契约。该 schema 写死了 `windows-x64`、`.exe`、`.cmd` 和 Windows venv 路径，因此属于 Windows 产品壳，不属于跨平台 `shared`。

The Windows desktop distribution has exactly two release artifacts:

```text
OpenDrSaiSetup-win-x64.msi
OpenDrSaiRuntime-win-x64.zip
```

`OpenDrSaiSetup-win-x64.msi` is the small user-facing installer. The
`OpenDrSaiSetup-{platform}-{arch}.msi` pattern is the required naming convention
for future installer builds. It does not contain the
full desktop app or Python environment. It embeds the expected runtime URL,
SHA256, and size, then waits while the bootstrapper downloads, verifies, and
installs the runtime. When the MSI completes successfully, OpenDrSai is fully
installed.

The MSI progress page stays visible for the entire operation and reports these
stages:

```text
Downloading OpenDrSai Runtime
Verifying the downloaded package
Extracting OpenDrSai Runtime
Installing OpenDrSai
Finishing OpenDrSai installation
```

During the download stage, the MSI updates its own progress bar and displays
the current percentage, downloaded and total megabytes, and transfer speed in
MB/s (or KB/s on slow links). The download is written to a `.partial` file and promoted to the runtime
ZIP only after the transfer completes; size and SHA256 verification still run
as separate installer stages.

PowerShell is launched through a hidden Windows Script Host runner, so neither
installation nor removal opens a Command Prompt or PowerShell window.

`OpenDrSaiRuntime-win-x64.zip` is the large OpenDrSai Runtime. It contains the
packaged Electron desktop app and a prepared `drsai-agent` Python environment.
The user machine does not need Git, Node.js, Visual Studio Build Tools, or a
network `pip install`.

## Runtime Layout

```text
OpenDrSaiRuntime-win-x64.zip
  opendrsai-runtime.json
  app/
    OpenDrSai.exe
    ...
  drsai-agent/
    venv/
      Scripts/
        python.exe
        drsai.cmd
        drsai-gateway.cmd
  drsai-home/
    .env
    config.yaml
```

## Build Runtime

The runtime builder expects a packaged desktop app and a prepared
`drsai-agent` directory with a populated venv:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\apps\desktop\windows\installer\create-opendrsai-runtime.ps1 `
  -DesktopAppDir .\apps\desktop\windows\release\win-unpacked `
  -DrsaiAgentDir .\apps\desktop\windows\.tmp\bootstrapper-msi3\.drsai\drsai-agent
```

Output:

```text
apps\desktop\windows\release\bootstrapper\OpenDrSaiRuntime-win-x64.zip
```

## Build MSI

Use WiX Toolset. The build script first looks for portable WiX binaries under
`.tools\wix314`, then falls back to `candle.exe` and `light.exe` on `PATH`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\apps\desktop\windows\installer\build-msi.ps1 `
  -RuntimePath .\apps\desktop\windows\release\bootstrapper\OpenDrSaiRuntime-win-x64.zip
```

Output:

```text
apps\desktop\windows\release\bootstrapper\OpenDrSaiSetup-win-x64.msi
```

For public releases, pass the public runtime URL while keeping `-RuntimePath` so
the MSI embeds the expected hash and size:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\apps\desktop\windows\installer\build-msi.ps1 `
  -RuntimePath .\apps\desktop\windows\release\bootstrapper\OpenDrSaiRuntime-win-x64.zip `
  -RuntimeUrl https://github.com/hepai-lab/drsai/releases/download/v1.4.6/OpenDrSaiRuntime-win-x64.zip
```

When `-RuntimeUrl` is omitted, `build-msi.ps1` derives the immutable versioned
GitHub Release URL from `BootstrapperVersion`. Do not use a `releases/latest`
URL: the MSI embeds a fixed Runtime size and SHA256, while `latest` can later
point to a different asset and make an otherwise valid installer fail.

Progress and failures are written to:

```text
%USERPROFILE%\.drsai\logs\bootstrapper
```

Completion is recorded in:

```text
%LOCALAPPDATA%\Programs\OpenDrSai\install-state.json
```

The MSI is a limited, per-user installation and does not request elevation.
Setup support files, the Electron application, the Python agent runtime, cache,
and install state live under `%LOCALAPPDATA%\Programs\OpenDrSai`. Configuration,
defaults, logs, credentials, and workspaces remain under `%USERPROFILE%\.drsai`.

Windows Installer registers `OpenDrSai` in Apps & features and Control Panel.
Uninstalling from either location removes the current user's installation and
shortcuts while preserving user data.
