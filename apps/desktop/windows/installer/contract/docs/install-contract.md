# Desktop Installer Contract

The Windows desktop installer ships as two release artifacts:

- `OpenDrSaiSetup-win-x64.msi`: the small user-facing MSI. Future MSI artifacts must follow `OpenDrSaiSetup-{platform}-{arch}.msi`.
- `OpenDrSaiRuntime-win-x64.zip`: the large OpenDrSai Runtime archive.

The MSI embeds the expected runtime URL, size, and SHA256. At install time it
downloads exactly one runtime archive, verifies it, and expands it. It does not
run `pip install`, clone Git repositories, or install Node.js.

The Windows bootstrapper performs an elevated per-machine installation:

- App root: `%PROGRAMFILES%\OpenDrSai`
- Setup support files: `%PROGRAMFILES%\OpenDrSai`
- Desktop app: `%PROGRAMFILES%\OpenDrSai\app`
- OpenDrSai agent runtime: `%PROGRAMFILES%\OpenDrSai\drsai-agent`
- User data: `%USERPROFILE%\.drsai`
- Cache: `%PROGRAMFILES%\OpenDrSai\cache`
- Installer logs: `%PROGRAMDATA%\OpenDrSai\Installer\logs`

The runtime archive must contain:

- `opendrsai-runtime.json`
- `app/OpenDrSai.exe`
- `drsai-agent/venv/Scripts/python.exe`
- `drsai-agent/venv/Scripts/drsai.cmd`
- `drsai-agent/venv/Scripts/drsai-gateway.cmd`

The installer writes `%PROGRAMFILES%\OpenDrSai\install-state.json` after a
successful install. New app and agent runtime directories are expanded into
staging first, then swapped into place after verification.

The MSI registers a per-machine Windows Installer product named `OpenDrSai`.
It must appear in Apps & features and Control Panel and support uninstall via
the registered `msiexec /x {ProductCode}` command. Uninstall removes all managed
files under `%PROGRAMFILES%\OpenDrSai` and preserves `%USERPROFILE%\.drsai`.
