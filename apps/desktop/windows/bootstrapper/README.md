# OpenDrSai Installer Bootstrapper

The bootstrapper is the small downloadable installer:

```text
OpenDrSai Installer.exe
```

It does not contain the full Electron app. It downloads the current full
installer from a release manifest, verifies the SHA256 hash, and launches the
full installer.

## Manifest

Default URL:

```text
https://github.com/hepai-lab/drsai/releases/latest/download/latest-windows.json
```

The schema lives in `latest-windows.schema.json`.

## Local Test

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\bootstrapper\install-full-app.ps1 `
  -ManifestUrl https://example.invalid/latest-windows.json
```

## Build

Use NSIS:

```powershell
makensis .\bootstrapper\OpenDrSaiInstaller.nsi
```

The generated installer should stay small because it only embeds this script and
minimal NSIS UI resources.

