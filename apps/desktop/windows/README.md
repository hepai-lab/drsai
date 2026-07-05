# OpenDrSai Windows Desktop

This directory is the new Windows-first desktop implementation. It is intended
to replace the Hermes-derived renderer in `apps/desktop/drsai-desktop` without
reusing its startup flow or visual shell.

## Goals

- Keep the Windows desktop product code here, under `apps/desktop/windows`.
- Keep Electron main/preload as the desktop security and native-capability
  boundary.
- Make the renderer visually close to `apps/webui/frontend`, while avoiding a
  direct Gatsby embed.
- Reuse WebUI selectively through pure React components, data models, and visual
  conventions.
- Ship a tiny `OpenDrSai Installer.exe` bootstrapper that downloads and installs
  the full desktop package.

## Project Layout

```text
windows/
|-- bootstrapper/              # Small online installer assets
|-- src/main/                   # Electron main process
|-- src/preload/                # Context bridge API
|-- src/renderer/               # WebUI-inspired desktop renderer
|-- src/shared/                 # Types shared by main/preload/renderer
|-- electron-builder.yml        # Full app packaging
`-- package.json
```

## Development

```powershell
cd C:\path\to\drsai
.\scripts\windows-desktop-dev.cmd
```

That command links `%USERPROFILE%\.drsai\drsai-agent` to the current checkout,
creates or reuses the backend venv, installs the Python package in editable
mode, installs desktop npm dependencies when needed, and starts Electron dev
mode with `DRSAI_HOME` set. After the first successful install, later runs
reuse the healthy linked backend and go straight to the desktop startup path.

Useful variants:

```powershell
.\scripts\windows-desktop-dev.cmd -InstallOnly
.\scripts\windows-desktop-dev.cmd -InstallOnly -ForceInstall
.\scripts\windows-desktop-dev.cmd -InstallPrerequisites
.\scripts\windows-desktop-dev.cmd -SkipNpmInstall
```

Use the `.cmd` wrapper for double-click or normal terminal startup. If you run
the PowerShell file directly, invoke it from a PowerShell terminal with
`powershell -ExecutionPolicy Bypass -File .\scripts\windows-desktop-dev.ps1`.

From the desktop app directory, the same flow is available as npm scripts:

```powershell
cd apps\desktop\windows
npm run dev:bootstrap
npm run dev:install
npm run dev:repair
```

After the developer backend is installed, the raw Electron dev command is:

```powershell
cd apps\desktop\windows
npm install
npm run dev
```

Release-critical top-level npm dependencies are pinned to exact versions. Use
intentional package upgrades rather than broad semver ranges when updating the
Windows desktop toolchain.

The renderer installs a mock `window.openDrSai` API only when Electron preload
has not provided the real API. That makes the same UI usable in Vite/browser
visual checks without weakening the packaged Electron boundary.

When using the local `drsai` conda environment on this machine, make sure its
root directory is on `PATH` so nested npm scripts can find `npm.cmd`:

```powershell
$env:PATH = "C:\Users\HUAWEI\.conda\envs\drsai;$env:PATH"
cd apps\desktop\windows
npm run dev
```

## Packaging

Build and verify the full desktop app:

```powershell
cd apps\desktop\windows
npm run build
npm run verify
npm run verify:ui
npm run verify:visual
npm run verify:packaged
npm run verify:install-check
npm run build:unpack
npm run build:win
npm run verify:artifacts
```

`verify:ui` checks renderer source invariants. `verify:visual` loads the built
production renderer in Electron with a test preload bridge, then checks the
bridge-missing fallback, responsive viewports, update feedback, and a streamed
chat interaction. It writes PNG evidence to `release/visual-checks/` by default;
set `OPENDRSAI_VISUAL_ARTIFACT_DIR` to redirect those screenshots.
`verify:packaged` starts `release/win-unpacked/OpenDrSai.exe` with a temporary
`DRSAI_HOME` and runs real main/preload/IPC checks without installing the backend.

`electron-builder.yml` packages the repository installer script as
`resources/install/install.ps1`. The Electron main process resolves that
resource first, so `desktop:start-install` works in both dev and packaged
builds.

Each desktop-triggered install writes a timestamped log under
`%USERPROFILE%\.drsai\logs\desktop-install-*.log` and shows that path in the
Overview diagnostics panel.

The desktop UI exposes two install actions:

- `Install / Repair` runs the DrSai installer and reports missing Python/Git.
- `Auto-install Dependencies` passes `-InstallPrerequisites`, allowing
  `install.ps1` to use `winget` for Python 3.11 and Git when they are missing.

On first launch after the full desktop package is installed, the renderer
automatically starts `Install / Repair` when Python and Git are already present
and the backend is missing. If prerequisites are missing, the user stays in
control and can choose `Auto-install Dependencies`.

Packaged builds also compare the installed backend version with the desktop
package version. A mismatch is treated as `Repair required`, which lets a shell
update pull the matching backend tag on the next launch.

Generate the release manifest consumed by the small installer:

```powershell
$env:OPENDRSAI_RELEASE_BASE_URL = "https://github.com/hepai-lab/drsai/releases/download/v0.1.0"
npm run manifest:win
```

Build the small bootstrapper after installing NSIS:

```powershell
powershell -ExecutionPolicy Bypass -File bootstrapper\build.ps1
```

The bootstrapper downloads `latest-windows.json`, validates the manifest,
downloads the full installer from the allowed HTTPS release hosts, verifies size
and SHA256, checks `minimumBootstrapperVersion`, and then launches the full
installer.

See `docs/release-checklist.md` for signing, public Release assets, and clean
machine smoke tests.

## Reuse Policy

Do not import Gatsby pages or WebUI route modules directly. Components moved
from WebUI must be made framework-neutral first:

- no `gatsby/*` imports
- no direct `/api/*` fetch calls
- no direct browser WebSocket ownership
- no dependency on WebUI auth/session globals
- all data comes through props or a desktop adapter
