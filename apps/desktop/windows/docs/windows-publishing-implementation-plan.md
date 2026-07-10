# OpenDrSai Windows Publishing Implementation Plan

This document turns the Windows publishing research into a repository-owned
release plan for the Electron app in this directory.

## Release Channels

OpenDrSai should ship through three coordinated channels:

1. GitHub Release direct download for early public builds, gray releases, and
   enterprise users who need a standalone installer.
2. Microsoft Store for the trusted consumer-facing channel after Partner Center
   identity, Store listing, privacy policy, and certification evidence are
   ready.
3. Windows Package Manager (`winget`) as a developer and IT-friendly discovery
   channel that points at the same versioned GitHub Release installer.

The repository already builds the direct download channel with NSIS,
`latest.yml`, `latest-windows.json`, release summaries, bootstrapper signing,
and public release verification. The work below keeps that channel as the
source of truth, then derives Store and winget submissions from it.

## Current Implementation State

Implemented in this workspace:

- `electron-builder.yml` builds a signed NSIS installer named
  `OpenDrSai-${version}-setup.exe`.
- `npm run manifest:win` creates `release/latest-windows.json` from the
  versioned installer.
- `npm run summary:win`, `npm run verify:artifacts`,
  `npm run verify:signatures`, and `npm run verify:public-release` validate
  hashes, sizes, updater metadata, bootstrapper metadata, and Authenticode
  signing state.
- `npm run winget:manifest` generates a multi-file winget manifest under
  `release/winget/` from the verified release manifest.
- The Windows desktop CI workflow generates those winget manifests and uploads
  `release/winget/**/*.yaml` as workflow artifacts for the package manager PR.
- `store/electron-builder.appx.template.yml` records the Store/AppX build
  configuration that must be filled with Partner Center identity values before
  the first Store package is produced.
- `store/store-listing.template.json` records the Store listing, privacy,
  support, screenshot, certification, and data-safety fields required before
  Partner Center submission.

## Direct Download Release Path

1. Build and test the app:

   ```powershell
   npm run build
   npm run verify:visual
   npm run verify:packaged
   npm run verify:install-check
   npm run build:win
   ```

2. Generate release metadata:

   ```powershell
   $env:OPENDRSAI_RELEASE_BASE_URL = "https://github.com/hepai-lab/drsai/releases/download/v1.4.0"
   npm run manifest:win
   npm run summary:win
   ```

3. Sign both executables and verify strict release readiness:

   ```powershell
   $env:REQUIRE_SIGNED_WINDOWS_ARTIFACTS = "1"
   $env:EXPECTED_WINDOWS_SIGNER_THUMBPRINT = "<certificate-thumbprint>"
   npm run sign:bootstrapper
   npm run verify:signatures
   npm run verify:release-ready
   ```

4. Publish the GitHub Release as a draft first, promote only after
   `Windows Release Promote` and `Windows Public Release Verification` pass.

## Microsoft Store Release Path

Partner Center setup:

- Create a Company developer account for the public OpenDrSai publisher.
- Reserve the final Store product name.
- Record the Partner Center package identity name, publisher subject, publisher
  display name, Store support URL, and privacy policy URL.
- Keep these values in release secrets or a private release runbook, not in this
  public template until they are final.

Store package preparation:

- Use `store/electron-builder.appx.template.yml` as the starting point.
- Replace all `__PARTNER_CENTER_*__` placeholders with Partner Center identity
  values.
- Use `store/store-listing.template.json` as the submission metadata checklist.
  Replace the privacy/support URL placeholders in the private release runbook
  after those public pages are live.
- Build an AppX package with the Store config after the normal app build.
- Run Microsoft Store certification checks before submission.
- If AppX submission is blocked by Electron or Store policy constraints, use
  the existing signed NSIS installer as a non-game Win32 direct-link submission
  through Partner Center. The installer URL must be versioned, HTTPS, immutable,
  signed, standalone, and silent-install capable.

Store listing requirements:

- Accurate app name and description.
- Screenshots for the supported Windows form factors.
- Privacy policy URL because this desktop app can access user, workspace, and
  AI request data.
- Support URL or support email.
- Certification notes, including login/demo account requirements if a build
  requires a remote service account.
- Clear health/AI disclaimers if the product is presented for medical or
  health-related use.

## Winget Release Path

After direct download artifacts are generated and verified:

```powershell
npm run winget:manifest
```

The generator writes:

- `release/winget/HepAI.OpenDrSai/<version>/HepAI.OpenDrSai.yaml`
- `release/winget/HepAI.OpenDrSai/<version>/HepAI.OpenDrSai.installer.yaml`
- `release/winget/HepAI.OpenDrSai/<version>/HepAI.OpenDrSai.locale.en-US.yaml`

The Windows desktop workflow uploads these files as build artifacts, so the
release operator can submit the exact generated manifest folder after the
GitHub Release URL and installer hash are verified.

Before submitting to `microsoft/winget-pkgs`:

- Confirm the GitHub Release asset URL is public and versioned.
- Confirm the installer sha256 matches the released binary.
- Confirm `/S` performs a silent install for the NSIS installer.
- Run `winget validate` locally when Windows Package Manager tooling is
  available.
- Submit the generated version folder as a PR to the community repository.

## Compliance Checklist

- Public installers are Authenticode signed and timestamped.
- `release-summary.json` marks public distribution ready only when executable
  signatures are valid.
- The privacy policy describes local files, workspace paths, prompts,
  conversations, logs, backend services, and any cloud model calls.
- Store metadata does not claim medical diagnosis, emergency support, or
  unsupported clinical decision making.
- Any health-sensitive data flow uses explicit user consent and secure
  transport.
- Store screenshots and descriptions match the shipped build.
- Version tags match `package.json` so backend repair installs the matching
  backend tag.

## Completion Gates

The local engineering gate is:

```powershell
npm run verify:publishing
npm run verify:store
npm run verify:release-ready
```

The external release gate is:

```powershell
$env:OPENDRSAI_RELEASE_BASE_URL = "https://github.com/hepai-lab/drsai/releases/download/v<version>"
$env:EXPECTED_WINDOWS_SIGNER_THUMBPRINT = "<certificate-thumbprint>"
$env:VERIFY_PUBLIC_RELEASE_DOWNLOAD = "1"
npm run verify:public-release
```

Do not promote a public release or submit Store/winget entries until both gates
pass for the same version.
