"""
bridge_latest.py — 指向当前最新 bridge 版本的索引
==================================================
当前最新 = versions/bridge_v1.py（asyncio 优化版）。

本文件只做一件事：把 versions/ 下的最新版本作为"latest"暴露出来，
这样：
    python bridge_latest.py
等价于运行最新版本，而历史版本（v0/v1/...）都完整保留在 versions/ 下，
便于做 A/B 性能对比（见 VERSIONS.md）。

升级到 v2 时，只需把下面的 _LATEST 改成 "bridge_v2"。
"""

from __future__ import annotations

import os
import sys
import importlib.util

# 当前最新版本（要切换 latest 指向，改这一行即可）
_LATEST = "bridge_v1"

_here = os.path.dirname(os.path.abspath(__file__))
_target = os.path.join(_here, "versions", f"{_LATEST}.py")

if not os.path.exists(_target):
    raise FileNotFoundError(f"latest 指向的版本不存在: {_target}")

# 让 versions/ 可被 import（如果未来版本间互相引用）
sys.path.insert(0, os.path.join(_here, "versions"))

_spec = importlib.util.spec_from_file_location(_LATEST, _target)
_mod = importlib.util.module_from_spec(_spec)
sys.modules[_LATEST] = _mod
_spec.loader.exec_module(_mod)

# 重新导出最新版本的所有公共符号，使本模块可作为 latest 直接 import
globals().update({k: v for k, v in vars(_mod).items() if not k.startswith("__")})


if __name__ == "__main__":
    # 等价于运行最新版本的入口
    import asyncio

    if hasattr(_mod, "run_bot_async"):
        try:
            asyncio.run(_mod.run_bot_async())
        except KeyboardInterrupt:
            print("\nBot 已停止。")
    elif hasattr(_mod, "run_bot"):
        try:
            _mod.run_bot()
        except KeyboardInterrupt:
            print("\nBot 已停止。")
    else:
        raise RuntimeError(f"{_LATEST} 没有可识别的入口函数 (run_bot_async / run_bot)")
