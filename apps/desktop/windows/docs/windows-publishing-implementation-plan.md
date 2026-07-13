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

The repository builds the direct download channel with a WiX MSI,
`OpenDrSaiRuntime-win-x64.zip`, `latest-windows.json`, release summaries,
signing gates and public release verification. That channel is the source of
truth for later Store and winget submissions.

## Current Implementation State

The active Windows distribution contract is the per-user MSI bootstrapper plus
`OpenDrSaiRuntime-win-x64.zip`. The MSI downloads and verifies the runtime, then
installs the Electron application and Python agent into stable per-user paths.

The repository also contains an older NSIS/electron-updater design. That design
is not the active release path: the current build does not publish an NSIS setup
executable, blockmap, or usable `latest.yml`, and the application previously
exposed update checking without download or installation. Release and update
work must therefore use the runtime archive contract below rather than mixing
the two installer layouts.

Implemented in this workspace:

- `electron-builder.yml` builds the unpacked Electron application consumed by
  the runtime archive.
- The WiX MSI bootstrapper downloads a pinned runtime URL and verifies its size
  and SHA-256 before installation.
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

## Runtime Auto-Update MVP

### Product contract

Users install `OpenDrSaiSetup.msi` once. From the second release onward, the
desktop application checks `latest-windows.json`, downloads the versioned
`OpenDrSaiRuntime-win-x64.zip`, verifies and stages it, exits, and delegates the
directory swap to an updater outside the running application directory. The
runtime archive updates the Electron application and Python agent together.

User-owned data is outside the replacement set. OIDC state, Electron user data,
projects, conversations, workspace files, and `.drsai` configuration remain in
place. Only these managed runtime paths are replaced:

- `%LOCALAPPDATA%\Programs\OpenDrSai\app`
- `%USERPROFILE%\.drsai\drsai-agent`

### Update manifest

The stable pointer is `latest-windows.json`. Runtime URLs inside it must be
immutable, versioned HTTPS Release URLs rather than `latest/download` aliases.
The schema is versioned and contains:

- schema version, application version, channel, publication time;
- minimum updater version and optional mandatory-update flag;
- runtime URL, exact byte size, and SHA-256;
- optional release-notes URL;
- stable-channel signature requirement.

The client accepts only supported schema versions, newer semantic versions,
allowed release hosts, matching runtime manifests, and non-downgrade updates.
Plain HTTP is available only under an explicit test-only environment switch.

### Legacy beta compatibility window

`1.4.3-beta.1` shipped with two immutable client assumptions: it reads
`releases/latest/download/latest-windows.json`, and it requests the `stable`
manifest channel. GitHub excludes Releases marked as prereleases from that
pointer. Until the first Authenticode-signed stable version replaces this
window, compatibility beta Releases therefore use all of the following:

- a prerelease semantic version such as `1.4.3-beta.7`;
- a public, non-draft Release marked non-prerelease and explicitly made latest;
- a `stable` protocol channel so the installed beta.1 client accepts it;
- `requireSignature: false`, permitted only because the payload version itself
  is a prerelease; every stable semantic version still requires signatures;
- an immutable runtime URL under `/releases/download/v<version>/`.

`npm run verify:update-legacy-beta` guards the complete beta.1 discovery
contract. After publication, public acceptance must additionally fetch the
unversioned `releases/latest/download/latest-windows.json`, assert it resolves
to the new version, and perform a full runtime hash download.

### Client lifecycle

The updater state machine is `idle -> checking -> available -> downloading ->
verifying -> staging -> ready -> installing -> complete`. Cancellation returns
to `available`; errors enter `failed` without changing the installed runtime.

Packaged builds check after a short startup delay and then periodically. The UI
also offers manual check, download/cancel, and restart-to-update actions. Update
installation is blocked while agent/chat/file-review work is active. The main
process stops its managed gateway before exiting for installation.

### Atomic swap and rollback

The updater helper is copied to a stable directory outside `app`, waits for the
old process to exit, and swaps both managed runtime directories. It retains one
`.previous` copy of each directory and writes `update-state.json` before every
destructive transition. The new app must write a startup health marker within a
bounded timeout. Missing health confirmation, backend import/version mismatch,
or launch failure restores both previous directories and relaunches the old
application.

ZIP extraction rejects entries escaping the staging directory. Downloaded
bytes must match the manifest size and SHA-256. Stable public updates also
require a valid Authenticode signature whose signer matches the installed
publisher; unsigned updates are limited to explicit development/test mode.
The runtime packager copies only the managed Python `venv`; projects, caches,
downloaded apps, and user files beside a long-lived development agent are never
included in the distributable archive.

### Release ordering

For each `v<version>` Release:

1. Build and sign the MSI, Electron executable, updater helper, and runtime.
2. Generate `latest-windows.json` from the final immutable runtime bytes.
3. Upload the MSI, runtime ZIP, manifest, summary, and release notes to a draft.
4. Download and verify the draft assets, including signatures and hashes.
5. Publish the versioned Release.
6. Publish or replace the stable pointer only after every versioned asset is
   reachable. A failed release leaves the previous stable pointer unchanged.

### MVP acceptance gates

- A clean Windows user installs version N once with the MSI.
- Version N discovers N+1, downloads it, and restarts into N+1 without running
  the MSI again.
- Electron, Python agent, and backend all report N+1.
- OIDC login, projects, conversations, workspaces, and shortcuts survive.
- Corrupt size/hash, invalid manifest, unsupported host, and downgrade inputs
  are rejected before the installed runtime changes.
- A broken N+1 launch or backend rolls back to a working N automatically.
- Two consecutive upgrades (N -> N+1 -> N+2) pass on clean Windows 11; the
  release matrix also covers Windows 10 22H2 before public stable promotion.

Differential packages, silent forced installation, rollout percentages,
multiple retained rollback versions, and Store-managed updating are follow-up
work rather than MVP blockers.

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
   $env:OPENDRSAI_RELEASE_BASE_URL = "https://github.com/hepai-lab/drsai/releases/download/v1.4.2"
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
  the signed WiX MSI as a non-game Win32 direct-link submission
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
- Confirm `msiexec /i OpenDrSaiSetup.msi /qn` performs a silent per-user install.
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
