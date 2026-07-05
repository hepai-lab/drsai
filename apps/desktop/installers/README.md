# OpenDrSai Desktop Installers

This directory contains platform-specific desktop installers plus the shared
release contract they consume.

The installers are intentionally platform-native:

- `windows/` builds a small Windows bootstrapper exe.
- `macos/` can be added later with a macOS-native package or first-run flow.
- `shared/` defines the manifest schema and release artifact contract.

The Windows bootstrapper installs OpenDrSai from release artifacts instead of
embedding the full desktop app. It downloads a desktop archive and a backend
archive, verifies SHA256 and size, installs them under the user profile, writes
install state, creates shortcuts, and can launch OpenDrSai.
