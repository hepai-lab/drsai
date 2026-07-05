# Desktop Installer Contract

The desktop bootstrapper consumes a release manifest with per-platform
artifacts. For Windows, the required payload is:

- `desktop`: a zip archive containing the packaged OpenDrSai desktop app.
- `backend`: a source archive accepted by `scripts/install.ps1`.

The Windows bootstrapper installs to user-writable locations by default:

- App root: `%LOCALAPPDATA%\OpenDrSai`
- Desktop app: `%LOCALAPPDATA%\OpenDrSai\app`
- Backend checkout/venv source: `%USERPROFILE%\.drsai\drsai-agent`
- User data: `%USERPROFILE%\.drsai`
- Cache: `%LOCALAPPDATA%\OpenDrSai\cache`
- Logs: `%USERPROFILE%\.drsai\logs\bootstrapper`

The installer writes `%LOCALAPPDATA%\OpenDrSai\install-state.json` after a
successful install. New app/backend directories are expanded into temporary
directories first, then swapped into place after verification.
