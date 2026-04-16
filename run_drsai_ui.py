from drsai_ui.run_ui import ui
import os,sys
from pathlib import Path
from drsai.configs.constant import FS_DIR

# parent_path = os.path.dirname(os.path.abspath(__file__))
# appdir = os.path.join(parent_path, "tmp/drsai_ui")
# os.makedirs(appdir, exist_ok=True)

from dotenv import load_dotenv
load_dotenv()

# HERE = Path(__file__).parent
WORKSPACE = Path(FS_DIR) / "workspace"
WORKSPACE.mkdir(parents=True, exist_ok=True)
DATASET = WORKSPACE / "drsai_ui"
DATASET.mkdir(parents=True, exist_ok=True)

if __name__ == "__main__":
    ui(
        # reload=True,
        port=8086,
        appdir=DATASET,
        database_uri= f"sqlite:////{DATASET}/drsai_ui.db",
    )