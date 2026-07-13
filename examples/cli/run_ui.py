import os
import sys

# Local dev: load `drsai` from this repo so we do not pick up another checkout
# (e.g. a sibling `.../workspace/drsai/...`) that happens to appear earlier on sys.path.
# Must run before importing `drsai_ui`, which may transitively import `drsai`.
_here = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_here, "..", ".."))
_drsai_src = os.path.join(_repo_root, "python", "packages", "drsai", "src")
if os.path.isdir(os.path.join(_drsai_src, "drsai")):
    sys.path.insert(0, _drsai_src)

from drsai_ui.run_ui import ui

parent_path = _here
appdir = os.path.join(parent_path, "tmp/drsai_ui")
os.makedirs(appdir, exist_ok=True)

from dotenv import load_dotenv
load_dotenv()

if __name__ == "__main__":
    ui(
        # reload=True,
        port=8086,
        appdir=appdir,
        database_uri= f"sqlite:////{appdir}/drsai_ui.db",
    )