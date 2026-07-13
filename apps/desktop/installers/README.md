# OpenDrSai Desktop Installers

This directory contains platform-specific desktop installers plus the shared
release contract they consume.

The installers are intentionally platform-native:

- `windows/` builds a small Windows bootstrapper exe.
- `macos/` can be added later with a macOS-native package or first-run flow.
- `shared/` defines the manifest schema and release artifact contract.

The Windows bootstrapper installs OpenDrSai from a single OpenDrSai Runtime
archive instead of embedding the full desktop app in the MSI. It downloads
`OpenDrSaiRuntime-win-x64.zip`, verifies SHA256 and size, installs it under the
current user, writes install state, creates shortcuts, and can launch OpenDrSai.
