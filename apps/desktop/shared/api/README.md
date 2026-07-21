# Desktop shared API

This directory is the canonical home for platform-neutral TypeScript contracts
used by the Windows and macOS desktop shells.

Rules:

- no imports from `windows/` or `macos/`;
- no Electron main-process implementation;
- no React components;
- no platform commands, paths, installers, or credential implementations;
- changes to a contract require shared contract tests and both platform builds.

The existing contracts under `windows/src/shared` will move here incrementally.
Temporary compatibility exports must be tracked in
`../test-kit/migration-inventory.json` and removed by M3.
