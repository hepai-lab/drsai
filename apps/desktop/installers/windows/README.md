# OpenDrSai Windows Desktop Bootstrapper

This installer builds a small UI exe named `OpenDrSaiSetup.exe`.

It embeds:

- `install-opendrsai.ps1`
- the repository `scripts/install.ps1`

At runtime it downloads the desktop and backend artifacts from the shared
manifest, verifies size and SHA256, installs them under the current user, writes
install state, creates shortcuts, and optionally launches OpenDrSai.

## Build

Install NSIS, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\apps\desktop\installers\windows\build.ps1
```

The output is:

```text
apps\desktop\windows\release\bootstrapper\OpenDrSaiSetup.exe
```

## Public Manifest

After creating `OpenDrSai-desktop-win-x64.zip` and
`opendrsai-backend-source.zip`, generate the manifest consumed by the small
online bootstrapper:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\apps\desktop\installers\windows\create-release-manifest.ps1 `
  -BaseUrl https://example.com/opendrsai/windows/1.4.0
```

## Local Manifest Test

Use `-ManifestUrl` with either an HTTPS URL, a local path, or a `file:///` URL:

```powershell
cd apps\desktop\windows
npm run build:unpack
cd ..\..\..
```

If local native rebuild prerequisites are not installed, use the fallback
unpacked-app creator after `npm run build`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\apps\desktop\installers\windows\create-unpacked-desktop.ps1
```

Then create and test the local manifest:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\apps\desktop\installers\windows\create-local-manifest.ps1
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\apps\desktop\installers\windows\install-opendrsai.ps1 `
  -ManifestUrl .\apps\desktop\windows\release\bootstrapper-local\desktop-installer-windows.local.json `
  -NoLaunch
```
