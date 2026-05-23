# DrSai

> A framework for developing AI Agent and Multi-Agent Systems, based on AutoGen 0.5.7. Developed by Dr. Sai's team at IHEP, CAS.

---

## Quick Start (End Users)

```bash
# Prerequisites: Python ≥ 3.11, Node.js ≥ 20

pip install drsai
drsai             # Launches the interactive TUI
```

That's it. The wheel ships with a pre-built TUI bundle — no `npm`/`pnpm`/`node_modules` setup needed.

---

## Architecture

DrSai ships **two processes** that talk over JSON-RPC:

```
┌─────────────────────────────────┐         ┌─────────────────────────────────┐
│  ui-tui (TypeScript + Ink)      │ ◀────▶  │  tui_gateway (Python)           │
│  React-based terminal UI        │  stdio  │  Agent orchestrator + RPC       │
└─────────────────────────────────┘         └─────────────────────────────────┘
                                                          │
                                                          ▼
                                            DrSaiCLIAssistant (autogen agent)
```

- **`ui-tui/`** — TypeScript/React/Ink frontend (compiled to single 5 MB ESM bundle)
- **`python/packages/drsai/`** — Python backend: agent, gateway, slash commands, session store

---

## Requirements

| Tool | Version | Why |
|------|---------|-----|
| Python | ≥ 3.11 | Backend, agent runtime |
| Node.js | ≥ 20 | Run the TUI bundle (`node dist/entry.mjs`) |
| pnpm | ≥ 9 (dev only) | Build the TUI bundle |
| pip / build | latest | Build the wheel |
| twine | latest | Upload to PyPI |

---

## Building & Publishing

### One-shot release build

From the repo root:

```bash
./scripts/build-wheel.sh
```

This script does three things:

1. `pnpm install && pnpm build` in `ui-tui/` → produces `ui-tui/dist/entry.mjs` (esbuild bundle, ~5 MB)
2. `python -m build --wheel` in `python/packages/drsai/` → produces `dist/drsai-X.Y.Z-py3-none-any.whl` (~1.6 MB compressed)
3. Verifies the bundle is correctly embedded inside the wheel at `drsai/ui_tui/dist/entry.mjs`

Output:

```
python/packages/drsai/dist/drsai-1.2.8-py3-none-any.whl  (1.6 MB)
```

### Manual step-by-step

Useful when debugging a single stage:

```bash
# 1. Build the TUI bundle
cd ui-tui
pnpm install          # first time only
pnpm build            # → dist/entry.mjs
cd -

# 2. Build the Python wheel
cd python/packages/drsai
rm -rf dist build     # clean previous artifacts
python -m build --wheel
cd -

# 3. Verify wheel contents
python -m zipfile -l python/packages/drsai/dist/drsai-*.whl | grep -E "ui_tui|entry\.mjs"
# Expected:
#   drsai/ui_tui/package.json
#   drsai/ui_tui/dist/entry.mjs
```

### Local install test (recommended before publishing)

```bash
# Test the wheel in a fresh venv
python -m venv /tmp/drsai-test
/tmp/drsai-test/bin/pip install python/packages/drsai/dist/drsai-1.2.8-py3-none-any.whl
/tmp/drsai-test/bin/drsai chat   # should launch the TUI

# Cleanup
rm -rf /tmp/drsai-test
```

### Upload to PyPI

```bash
# First time: install twine
pip install twine

# Test on TestPyPI first (recommended)
python -m twine upload --repository testpypi python/packages/drsai/dist/drsai-*.whl

# Then production PyPI
python -m twine upload python/packages/drsai/dist/drsai-*.whl
```

Credentials are read from `~/.pypirc` or env vars `TWINE_USERNAME` / `TWINE_PASSWORD`.

Example `~/.pypirc`:

```ini
[distutils]
index-servers =
    pypi
    testpypi

[pypi]
username = __token__
password = pypi-AgEIcHlwaS5vcmcC...   # your API token

[testpypi]
repository = https://test.pypi.org/legacy/
username = __token__
password = pypi-...                     # TestPyPI token
```

### Bumping the version

Edit a single file:

```python
# python/packages/drsai/src/drsai/version.py
__version__ = "1.2.9"  # ← bump here
```

`pyproject.toml` reads this dynamically via `[tool.hatch.version]`. No other file needs to change.

### Full release checklist

```bash
# 1. Bump version
$EDITOR python/packages/drsai/src/drsai/version.py

# 2. Build
./scripts/build-wheel.sh

# 3. Test in fresh venv
python -m venv /tmp/drsai-test
/tmp/drsai-test/bin/pip install python/packages/drsai/dist/drsai-1.2.9-py3-none-any.whl
/tmp/drsai-test/bin/drsai version           # confirm version
/tmp/drsai-test/bin/drsai chat              # confirm TUI works
rm -rf /tmp/drsai-test

# 4. Test full test suite still passes
python -m pytest python/packages/drsai/tests/tui_gateway/ -q
cd ui-tui && ./scripts/e2e-test.sh && cd -

# 5. Tag git release
git add -A
git commit -m "release: v1.2.9"
git tag v1.2.9
git push && git push --tags

# 6. Publish to TestPyPI
python -m twine upload --repository testpypi python/packages/drsai/dist/drsai-1.2.9-py3-none-any.whl

# 7. Verify install from TestPyPI
pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple drsai==1.2.9

# 8. Publish to PyPI
python -m twine upload python/packages/drsai/dist/drsai-1.2.9-py3-none-any.whl
```

---

## Development Setup

### Editable install (Python only)

```bash
cd python/packages/drsai
pip install -e .
```

### Run TUI from source (no bundle build)

```bash
cd ui-tui
pnpm install
pnpm dev          # runs tsx src/entry.tsx with hot reload
```

This spawns the Python gateway as a subprocess; the gateway picks up the `drsai` install (editable or otherwise).

### Run gateway standalone (for WebSocket attach)

```bash
DRSAI_TUI_ENABLE_WS=1 DRSAI_TUI_WS_PORT=8765 python -m drsai.backend.tui_gateway

# Then in another terminal:
drsai chat --attach ws://127.0.0.1:8765/attach
```

---

## Testing

### Python (gateway handlers)

```bash
cd /home/xiongdb/drsai
python -m pytest python/packages/drsai/tests/tui_gateway/ -v
# Expected: 7 passed in ~21s
```

### TypeScript (type check)

```bash
cd ui-tui
pnpm type-check
```

### End-to-end (UI + gateway + RPC)

```bash
cd ui-tui
./scripts/e2e-test.sh
# Expected: 4 checks pass
```

### Manual TUI smoke

```bash
cd ui-tui && pnpm dev    # or: drsai chat after pip install
# In the TUI:
/help                    # 42 slash commands listed
/model                   # pops up model picker
/list                    # pops up session picker
/dangerous on            # toggle, watch StatusBar badge update
```

---

## Project Layout

```
drsai/
├── ui-tui/                                  # TypeScript/Ink frontend
│   ├── src/                                 # source (entry.tsx, app.tsx, components/, hooks/)
│   ├── scripts/build.mjs                    # esbuild bundler
│   ├── dist/entry.mjs                       # built bundle (gitignored, regenerated)
│   └── package.json
│
├── python/packages/drsai/                   # Python package
│   ├── src/drsai/
│   │   ├── backend/
│   │   │   ├── run_cli.py                   # `drsai` CLI entry (thin launcher)
│   │   │   ├── tui_gateway/                 # JSON-RPC gateway
│   │   │   │   ├── entry.py                 # `drsai-gateway` entry point
│   │   │   │   ├── server.py                # RPC dispatcher
│   │   │   │   ├── handlers/                # session.*, prompt.*, slash.*, tools.*
│   │   │   │   └── adapter/                 # agent_runner, event_translator, callbacks
│   │   │   ├── gateway.py                   # Legacy SSE gateway (Electron desktop only)
│   │   │   ├── _deprecated/                 # Old prompt_toolkit REPL (kept for reference)
│   │   │   └── cli/                         # Shared utilities (config, history, commands)
│   │   ├── modules/agents/                  # DrSaiCLIAssistant, sub-agents
│   │   └── version.py                       # Single source of version
│   ├── tests/tui_gateway/                   # pytest suite
│   ├── docs/                                # design docs, migration guide
│   ├── pyproject.toml                       # build config
│   └── README.md                            # ← you are here
│
├── scripts/build-wheel.sh                   # One-shot release builder
└── desktop/                                 # Electron client (separate project)
```

---

## CLI Reference

```bash
drsai                       # Launch TUI (default)
drsai chat                  # Same as above
drsai chat --attach <ws>    # Connect to existing gateway via WebSocket
drsai tui-gateway           # Run gateway as standalone process
drsai gateway --port 8642   # Legacy SSE gateway (for Electron desktop)
drsai config --show         # View/edit config
drsai sessions              # List saved sessions
drsai version               # Print version
```

Console scripts installed by pip:

| Command | Module |
|---------|--------|
| `drsai` | `drsai.backend.run_cli:run` |
| `drsai-tui` | `drsai.backend.run_cli:run` (alias) |
| `drsai-gateway` | `drsai.backend.tui_gateway.entry:main` |

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `DRSAI_PYTHON` | Python interpreter for gateway subprocess | `python3` |
| `DRSAI_PYTHON_SRC_ROOT` | Override PYTHONPATH for gateway | auto |
| `DRSAI_UI_TUI_DIR` | Override ui-tui location | auto |
| `DRSAI_TUI_ENABLE_WS` | Start WebSocket server in gateway | unset |
| `DRSAI_TUI_WS_PORT` | WebSocket port | `8765` |
| `DRSAI_TUI_ATTACH_URL` | UI attaches via WebSocket instead of spawning | unset |
| `DRSAI_TUI_STARTUP_TIMEOUT_MS` | Gateway boot timeout | `15000` |
| `DRSAI_TUI_RPC_TIMEOUT_MS` | RPC call timeout | `120000` |
| `DRSAI_TUI_RPC_POOL_WORKERS` | Gateway threadpool size | `4` |
| `HEPAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | LLM credentials | unset |
| `LLM_CONFIG_FILE` | Path to model catalog YAML/JSON | from config |
| `SYSTEM_SKILLS_DIR` | Override skills directory | from config |

---

## Troubleshooting

### `pip install` succeeded but `drsai chat` errors out

**Check Node.js is installed and ≥ 20:**

```bash
node --version
```

If absent, install:
- macOS: `brew install node`
- Ubuntu/Debian: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install nodejs`
- Windows: <https://nodejs.org/>

### TUI starts but gateway crashes

Check the crash log:

```bash
tail -50 ~/.drsai/logs/tui_gateway_crash.log
```

### Bundle missing from wheel after build

The `force-include` paths in `pyproject.toml` are relative to the `wheel` build root, which is `python/packages/drsai/`. So `../../../ui-tui/dist/entry.mjs` walks up to the repo root. If you move the repo layout, update those paths.

Verify with:

```bash
python -m zipfile -l python/packages/drsai/dist/drsai-*.whl | grep ui_tui
```

Expected output:

```
drsai/ui_tui/package.json
drsai/ui_tui/dist/entry.mjs
```

### `python -m build` complains about hatchling

Install / upgrade the build toolchain:

```bash
pip install --upgrade build hatchling twine
```

### Tests fail with "session not found"

The test suite resolves sessions for the current user; sessions are stored in `~/.drsai/`. If you've never run `drsai` before, `session.create` will be exercised first.

### `drsai gateway` prints a deprecation warning

That's intentional. The old SSE `gateway.py` is preserved only for the Electron desktop client. The new TUI uses `drsai-gateway` (JSON-RPC).

---

## Documentation

- [`docs/tui-migration-guide.md`](docs/tui-migration-guide.md) — How to migrate from the legacy CLI
- [`docs/hermes-agent-tui-analysis.md`](docs/hermes-agent-tui-analysis.md) — Original design analysis

---

## License

MIT — see top-level `LICENSE` in the repo root.

## Authors

Dr. Sai's team — Institute of High Energy Physics, Chinese Academy of Sciences.
Contact: `xiongdb@ihep.ac.cn` / `hepai@ihep.ac.cn`
