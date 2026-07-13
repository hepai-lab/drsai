# Windows Release Checklist

This checklist describes the active MSI + unified runtime release path.

## Required assets

The release tag must equal `v<package.json version>`. Attach these files to the
same versioned GitHub Release:

- `OpenDrSaiSetup.msi` — first installation only;
- `OpenDrSaiRuntime-win-x64.zip` — Electron app and Python agent updated as one unit;
- `latest-windows.json` — schema-versioned update pointer with URL, size and SHA-256;
- `release-summary.json` — auditable size, hash and signing summary.

Do not publish the retired NSIS setup, blockmap or `latest.yml`. Runtime URLs in
`latest-windows.json` must point to the immutable versioned Release, never to a
moving `latest/download` URL.

## Build and local gates

```powershell
npm ci
npm run build:runtime
npm run verify:update-helper
npm run verify:e2e-update
npm run manifest:win
npm run verify:update-manifest
npm run build:bootstrapper
npm run summary:win
npm run verify:artifacts
```

The updater E2E gate covers checking, resumable download, size/hash validation,
staging, untrusted redirect rejection and downgrade protection. The helper gate
covers safe ZIP extraction, app/agent atomic replacement, target-version health
confirmation, cleanup and automatic rollback.

## Signing

Stable releases require the MSI and the `app/OpenDrSai.exe` contained in the
runtime ZIP to have valid Authenticode signatures from the same approved
publisher. Set the CI certificate secrets before building the runtime so the
executable is signed before it is archived.

```powershell
$env:REQUIRE_SIGNED_WINDOWS_ARTIFACTS = "1"
$env:EXPECTED_WINDOWS_SIGNER_THUMBPRINT = "<certificate-thumbprint>"
$env:EXPECTED_WINDOWS_SIGNER_SUBJECT = "<publisher subject>"
npm run sign:bootstrapper
npm run verify:signatures
```

Signing after manifest generation changes bytes and invalidates hashes. Build
and sign first, then generate `latest-windows.json` and `release-summary.json`.

## Draft, promote and public verification

Upload all four assets to a draft Release. Run the `Windows Release Promote`
workflow; it downloads the draft assets, verifies the runtime manifest, hashes
and signatures, and publishes only when explicitly requested.

After publication:

```powershell
$env:OPENDRSAI_RELEASE_BASE_URL = "https://github.com/hepai-lab/drsai/releases/download/v1.4.2"
$env:EXPECTED_WINDOWS_SIGNER_THUMBPRINT = "<certificate-thumbprint>"
$env:VERIFY_PUBLIC_RELEASE_DOWNLOAD = "1"
npm run verify:public-release
```

This downloads the public MSI and runtime, checks both metadata files and both
hash sources, extracts the shipped Electron executable, and verifies both
Authenticode signatures. The automatic public-release workflow runs the same
gate.

## Clean Windows acceptance

On Windows Sandbox or a clean Windows 11 VM:

1. Install version N using `OpenDrSaiSetup.msi` and confirm Start menu launch.
2. Complete OIDC login, send a chat request, close and reopen the app, and
   confirm the session persists.
3. Publish N+1 to the test channel. In the app, check, download, then choose
   restart and update. Do not run the MSI again.
4. Confirm the desktop, Python agent and backend report N+1, login remains, and
   chat still works.
5. Repeat N+1 -> N+2.
6. Supply a corrupt archive and a runtime whose app cannot confirm N+1; verify
   the installed runtime stays at N or rolls back to it and relaunches.
7. Confirm the gateway no longer requires a legacy API key when OIDC access-token
   authentication is active.

Before promoting stable, run:

```powershell
$env:REQUIRE_RELEASE_READY = "1"
$env:REQUIRE_SIGNED_WINDOWS_ARTIFACTS = "1"
$env:SKIP_PUBLIC_RELEASE_CHECK = "1"
npm run verify:release-ready
```

Store and winget submissions are follow-up distribution channels. They must use
the same signed MSI and versioned Release; Store-managed updating is separate
from this direct-download updater.
