from drsai_ui.run_ui import ui

import os,sys
parent_path = os.path.dirname(os.path.abspath(__file__))
appdir = os.path.join(parent_path, "tmp/drsai_ui")
os.makedirs(appdir, exist_ok=True)

from dotenv import load_dotenv
load_dotenv()

if __name__ == "__main__":
    ui(
        # reload=True,
        port=8081,
        appdir=appdir,
        database_uri= f"sqlite:////{appdir}/drsai_ui.db",
    )