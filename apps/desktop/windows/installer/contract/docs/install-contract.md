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

When the user selects a different installation directory, every runtime stage
and the uninstall action receive that resolved MSI `INSTALLFOLDER`; no stage
falls back to `%PROGRAMFILES%\OpenDrSai`.

The runtime archive must contain:

- `opendrsai-runtime.json`
- `app/OpenDrSai.exe`
- `drsai-agent/venv/Scripts/python.exe`
- `drsai-agent/venv/Scripts/drsai.cmd`
- `drsai-agent/venv/Scripts/drsai-gateway.cmd`

The installer writes `%PROGRAMFILES%\OpenDrSai\install-state.json` after a
successful install. New app and agent runtime directories are expanded into
staging first, then swapped into place after verification.

Before an install or upgrade swaps runtime directories, it terminates process
trees whose executables run from the managed installation root. Transient
file-lock failures during replacement are retried with bounded backoff.

The MSI registers a per-machine Windows Installer product named `OpenDrSai`.
It must appear in Apps & features and Control Panel and support uninstall via
the registered `msiexec /x {ProductCode}` command. Uninstall removes all managed
files under `%PROGRAMFILES%\OpenDrSai` and preserves `%USERPROFILE%\.drsai`.
Rebuilt packages may replace the same three-part product version so an installer
repair can supersede an already-published package without requiring manual
cleanup first.
Uninstall terminates all process trees running executables from the managed
installation root, retries transient deletion failures, and retains a
timestamped log under `%PROGRAMDATA%\OpenDrSai\Installer\logs` when cleanup
cannot complete.
