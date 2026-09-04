"""Load the WebUI .env before SERVICE_MODE / HepAI keys are read.

``load_dotenv()`` with no path only reads ``cwd/.env``. Starting
``drsai-ui`` from the repo root therefore misses ``apps/webui/.env``
(SERVICE_MODE=PROD, HEPAI_APP_ADMIN_API_KEY), and personal API keys
fall back to the shared ``HEPAI_API_KEY``.
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv


def webui_env_paths() -> list[Path]:
    """Candidate .env files, most specific first.

    ``apps/webui/.env`` is the canonical process config. cwd/.env is
    a local overlay that only fills variables not already set.
    """
    here = Path(__file__).resolve()
    # env_load.py lives at apps/webui/backend/src/drsai_ui/env_load.py
    webui_dir = here.parents[3]
    paths = [webui_dir / ".env", Path.cwd() / ".env"]
    seen: set[Path] = set()
    unique: list[Path] = []
    for path in paths:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        unique.append(path)
    return unique


def load_webui_dotenv() -> list[Path]:
    """Load WebUI env files without overriding variables already in the process.

    Returns the files that existed and were loaded.
    """
    loaded: list[Path] = []
    for path in webui_env_paths():
        if path.is_file():
            load_dotenv(str(path), override=False)
            loaded.append(path)
    return loaded
