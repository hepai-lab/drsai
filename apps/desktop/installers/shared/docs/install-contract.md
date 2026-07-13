# Desktop Installer Contract

The Windows desktop installer ships as two release artifacts:

- `OpenDrSaiSetup.msi`: the small user-facing MSI.
- `OpenDrSaiRuntime-win-x64.zip`: the large OpenDrSai Runtime archive.

The MSI embeds the expected runtime URL, size, and SHA256. At install time it
downloads exactly one runtime archive, verifies it, and expands it. It does not
run `pip install`, clone Git repositories, or install Node.js.

The Windows bootstrapper installs to user-writable locations by default:

- App root: `%LOCALAPPDATA%\Programs\OpenDrSai`
- Desktop app: `%LOCALAPPDATA%\Programs\OpenDrSai\app`
- OpenDrSai agent runtime: `%USERPROFILE%\.drsai\drsai-agent`
- User data: `%USERPROFILE%\.drsai`
- Cache: `%LOCALAPPDATA%\Programs\OpenDrSai\cache`
- Logs: `%USERPROFILE%\.drsai\logs\bootstrapper`

The runtime archive must contain:

- `opendrsai-runtime.json`
- `app/OpenDrSai.exe`
- `drsai-agent/venv/Scripts/python.exe`
- `drsai-agent/venv/Scripts/drsai.cmd`
- `drsai-agent/venv/Scripts/drsai-gateway.cmd`

The installer writes `%LOCALAPPDATA%\Programs\OpenDrSai\install-state.json` after a
successful install. New app and agent runtime directories are expanded into
staging first, then swapped into place after verification.
