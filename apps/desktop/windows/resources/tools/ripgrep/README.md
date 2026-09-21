# Bundled ripgrep (rg.exe)

`rg` is the search backend the DrSai agent's `grep` tool prefers. Windows has no
usable native equivalent (`findstr` is ASCII-only and skips UTF-16 files, and
`Select-String` costs 100-150 ms of PowerShell startup per call), so OpenDrSai
ships one pinned ripgrep binary instead of relying on whatever happens to be on
the user's PATH.

## Provenance

| Field | Value |
| --- | --- |
| Version | `15.2.0` (rev `e89fff89ac`) |
| Target | `x86_64-pc-windows-msvc` |
| Upstream | <https://github.com/BurntSushi/ripgrep/releases/tag/15.2.0> |
| Artifact | `ripgrep-15.2.0-x86_64-pc-windows-msvc.zip` |
| `rg.exe` size | 4 218 880 bytes |
| `rg.exe` SHA-256 | `14231169855EC5205CF5A1B6F1DB358FF4AED4247C86B69CE8AAE647C77F6680` |
| License | Unlicense OR MIT (see `UNLICENSE`, `LICENSE-MIT`, `COPYING`) |

The binary is a static single-file build: it imports only `KERNEL32.dll`,
`ntdll.dll` and `USERENV.dll`, so it needs no VC++ runtime and no extra DLLs
next to it. It is **not Authenticode-signed** — integrity is pinned by the
SHA-256 digest above (see `scripts/fetch-ripgrep.mjs` and
`scripts/verify-bundled-ripgrep.mjs`) rather than by a publisher signature.

## How it reaches users

`resources/**` is listed in `electron-builder.yml` under both `files` and
`asarUnpack`, so this directory is unpacked to
`<install>/resources/app.asar.unpacked/resources/tools/ripgrep/rg.exe` in the
packaged app (the same mechanism `resources/backend` already uses). Consumers
locate it through:

- `apps/desktop/shared/main/bundledTools.ts` → exported to the Python gateway as
  `DRSAI_RG_PATH` (see `shared/main/gateway.ts`).
- `cores/python/.../skills_agent/managers/operater_funs.py` →
  `_detect_ripgrep_executable()`, which also probes `DRSAI_RG_PATH`, PATH, and
  `~/.drsai/bin/rg.exe` so the TUI and a bare `drsai` CLI install find it too.

## Refreshing

```powershell
# Re-download, verify the pinned digest, and re-vendor rg.exe + licenses:
node apps/desktop/windows/scripts/fetch-ripgrep.mjs

# Verify the vendored copy without touching the network:
node apps/desktop/windows/scripts/fetch-ripgrep.mjs --check
```

When bumping the version, update `RIPGREP_VERSION`, `RIPGREP_RG_SHA256` and this
table together — `verify-bundled-ripgrep.mjs` fails the build if they disagree.

Run the wiring check on its own, or as part of the Windows suite (from
`apps/desktop/windows`):

```powershell
npm run verify:bundled-ripgrep
npm run verify
```

Python side: `cores/python/packages/drsai/tests/test_bundled_ripgrep.py` covers
`_detect_ripgrep_executable()` (override, payload, PATH, `~/.drsai/bin` fallbacks).
