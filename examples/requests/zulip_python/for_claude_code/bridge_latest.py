"""
bridge_latest.py — 指向当前最新版本的入口
当前最新: versions/cc_bridge_v5.py
"""
import importlib.util, os, sys

_here    = os.path.dirname(os.path.abspath(__file__))
_latest  = os.path.join(_here, "versions", "cc_bridge_v5.py")

spec = importlib.util.spec_from_file_location("cc_bridge_latest", _latest)
mod  = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

if __name__ == "__main__":
    mod.run_bot()
