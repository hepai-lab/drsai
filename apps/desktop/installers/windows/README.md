# OpenDrSai Windows Installer

The Windows desktop distribution has exactly two release artifacts:

```text
OpenDrSaiSetup.msi
OpenDrSaiRuntime-win-x64.zip
```

`OpenDrSaiSetup.msi` is the small user-facing installer. It does not contain the
full desktop app or Python environment. It embeds the expected runtime URL,
SHA256, and size, then waits while the bootstrapper downloads, verifies, and
installs the runtime. When the MSI completes successfully, OpenDrSai is fully
installed.

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
  -File .\apps\desktop\installers\windows\create-opendrsai-runtime.ps1 `
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
  -File .\apps\desktop\installers\windows\build-msi.ps1 `
  -RuntimePath .\apps\desktop\windows\release\bootstrapper\OpenDrSaiRuntime-win-x64.zip
```

Output:

```text
apps\desktop\windows\release\bootstrapper\OpenDrSaiSetup.msi
```

For public releases, pass the public runtime URL while keeping `-RuntimePath` so
the MSI embeds the expected hash and size:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\apps\desktop\installers\windows\build-msi.ps1 `
  -RuntimePath .\apps\desktop\windows\release\bootstrapper\OpenDrSaiRuntime-win-x64.zip `
  -RuntimeUrl https://example.com/OpenDrSaiRuntime-win-x64.zip
```

Progress and failures are written to:

```text
%USERPROFILE%\.drsai\logs\bootstrapper
```

Completion is recorded in:

```text
%LOCALAPPDATA%\Programs\OpenDrSai\install-state.json
```
