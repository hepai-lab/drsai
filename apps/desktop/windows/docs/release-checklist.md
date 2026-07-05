# Windows Release Checklist

This checklist covers the parts that cannot be fully proven by local builds.

## Required Release Assets

Use a release tag that matches the desktop package version, for example
`v0.1.0` for `package.json` version `0.1.0`. Packaged apps install the matching
backend branch/tag by default, so publishing to an unrelated tag can make
`Install / Repair` clone the wrong backend or fail.
After an app update, the desktop shell marks a mismatched backend as requiring
repair, so the matching tag must exist before users receive the release.
The release workflow also clones that backend tag and verifies
`python -m drsai.backend.run_cli version` reports the same semantic version as
the desktop package.

Upload these files to the public GitHub Release:

- `OpenDrSai-${version}-setup.exe`
- `OpenDrSai-${version}-setup.exe.blockmap`
- `latest.yml`
- `latest-windows.json`
- `release-summary.json`
- `OpenDrSai Installer.exe`

The first three are consumed by `electron-updater`. `latest-windows.json` and
`OpenDrSai Installer.exe` are consumed by the tiny bootstrapper.
`release-summary.json` is for human and CI audit of sizes, hashes, and
signature status.
When executables are unsigned, `release-summary.json` marks
`distribution.publicDistributionReady` as `false` and lists the unsigned
artifacts.
CI also uploads `release/visual-checks/*.png` as workflow artifacts for visual
review. These screenshots are not required public Release assets.
`minimumBootstrapperVersion` is enforced by the tiny installer; raise it when a
future manifest requires newer bootstrapper behavior.
Top-level npm dependencies are pinned to exact versions so Electron,
electron-builder, electron-updater, Vite, React, and Tailwind do not drift during
manual release preparation.

## Code Signing

Unsigned builds are useful for development, but production releases should be
Authenticode signed before public distribution.

Recommended CI secrets:

- `WINDOWS_CERTIFICATE`: base64 encoded `.pfx`
- `WINDOWS_CERTIFICATE_PASSWORD`: certificate password
- `WINDOWS_CERTIFICATE_THUMBPRINT`: expected Authenticode signer thumbprint

Recommended CI variables:

- `WINDOWS_CERTIFICATE_SUBJECT`: expected signer subject fragment

After signing, verify both executables:

```powershell
npm run sign:bootstrapper
Get-AuthenticodeSignature .\release\OpenDrSai-0.1.0-setup.exe
Get-AuthenticodeSignature ".\release\bootstrapper\OpenDrSai Installer.exe"
$env:REQUIRE_SIGNED_WINDOWS_ARTIFACTS = "1"
$env:EXPECTED_WINDOWS_SIGNER_THUMBPRINT = "<certificate-thumbprint>"
npm run verify:signatures
```

The full installer is signed by `electron-builder` while it builds
`latest.yml`. Do not re-sign the full installer after `latest.yml` is generated,
because that changes the updater hash. The tiny bootstrapper is built outside
electron-builder and is signed separately by `npm run sign:bootstrapper`.
The tiny bootstrapper also passes the expected signer thumbprint/subject into
its embedded download script, so the downloaded full installer must be signed by
the configured OpenDrSai publisher certificate, not merely any trusted
certificate.

The CI workflow treats unsigned artifacts as a warning for ordinary development
builds, but fails tag/manual publish builds when signing secrets are missing or
the strict signature gate does not pass.

## Public Release Verification

After publishing the draft Release, verify the public asset URLs before handing
the bootstrapper to users:

```powershell
$env:OPENDRSAI_RELEASE_BASE_URL = "https://github.com/hepai-lab/drsai/releases/download/v0.1.0"
$env:EXPECTED_WINDOWS_SIGNER_THUMBPRINT = "<certificate-thumbprint>"
npm run verify:public-release
$env:VERIFY_PUBLIC_RELEASE_DOWNLOAD = "1"
npm run verify:public-release
```

The first command checks manifest/updater metadata and asset reachability. The
second command also downloads the full setup exe, verifies its sha256/size
against `latest-windows.json`, verifies its sha512 against `latest.yml`, and
checks its Authenticode signature on Windows.
Both commands also verify that public `release-summary.json` matches the
published assets and marks `distribution.publicDistributionReady` as `true`.

Publishing the GitHub Release also triggers the
`Windows Public Release Verification` workflow. Use its manual dispatch with a
release tag when re-checking an already-published Release.

Before promoting the draft Release, run the aggregate readiness gate:

```powershell
$env:REQUIRE_RELEASE_READY = "1"
$env:REQUIRE_SIGNED_WINDOWS_ARTIFACTS = "1"
$env:VERIFY_PUBLIC_RELEASE_DOWNLOAD = "1"
npm run verify:visual
npm run verify:packaged
npm run verify:install-check
npm run verify:release-ready
```

CI runs the same aggregate gate before uploading assets with
`SKIP_PUBLIC_RELEASE_CHECK=1`, because draft Release assets are not publicly
reachable yet. After publishing the Release, run the gate again without that
skip flag so public URLs are verified too.

Use `Windows Release Promote` to publish the draft Release. It downloads the
draft assets through the GitHub API, reconstructs the local `release/` layout,
then runs `verify:manifest`, `verify:artifacts`, and strict
`verify:signatures`. Set `promote=true` only when that job should publish the
draft. After promotion, the `Windows Public Release Verification` workflow
checks the public URLs and downloaded installer.

## End-to-End Smoke Tests

Run these on a clean Windows 11 user account:

1. No Python/Git installed: run the tiny bootstrapper.
2. Python/Git missing: use `Auto-install Dependencies`.
3. No API key: confirm Settings can save `HEPAI_API_KEY`.
4. Start gateway and send one chat message.
5. Install an older version, publish a newer public release, then verify
   `Check Updates -> Download Update -> Install Update`.
6. Force one failed install and confirm
   `%USERPROFILE%\.drsai\logs\desktop-install-*.log` contains actionable output.
7. Repeat behind the expected corporate proxy/VPN if enterprise users are in
   scope.

Use the bundled smoke helper to keep the clean-machine checks repeatable:

```powershell
$env:OPENDRSAI_RELEASE_BASE_URL = "https://github.com/hepai-lab/drsai/releases/download/v0.1.0"
npm run smoke:clean-win -- `
  -ReleaseBaseUrl $env:OPENDRSAI_RELEASE_BASE_URL `
  -BootstrapperPath ".\release\bootstrapper\OpenDrSai Installer.exe" `
  -RunBootstrapper `
  -LaunchApp `
  -RequireBackend `
  -ExpectedVersion "0.1.0"
```

The helper verifies the published manifest, release summary, bootstrapper
signature, installed app, backend import, CLI version, installer log, and
expected backend version. After starting the gateway in the app, run:

```powershell
npm run smoke:clean-win -- -WaitForGateway -ExpectedVersion "0.1.0"
```

The gateway check validates both `/health` and `/v1/models`.
