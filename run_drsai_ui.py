from drsai_ui.run_ui import ui
from pathlib import Path
from drsai.configs.constant import FS_DIR

from dotenv import load_dotenv

load_dotenv()

WORKSPACE = Path(FS_DIR) / "workspace"
WORKSPACE.mkdir(parents=True, exist_ok=True)
DATASET = WORKSPACE / "drsai_ui"
DATASET.mkdir(parents=True, exist_ok=True)

if __name__ == "__main__":
    ui(
        port=8081,
        appdir=str(DATASET),
        database_uri=f"sqlite:////{DATASET}/drsai_ui.db",
    )