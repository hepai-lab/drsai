#!/usr/bin/env python3
"""检查 deck workspace 的关键目录与核心输入是否齐全。

定位与作用
----------
这个脚本不判断页面美不美，而是判断 workspace 是否具备继续工作的最低条件。
它默认检查新的精简 workspace：`brief.md + deck_narrative.md + data/assets/build/validation/final`。
如果检测到旧的 `brief/ plan/ content/` 结构，会给出迁移 warning，但不会静默把旧结构当成新默认。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


REQUIRED_DIRS = ("data", "assets", "build", "validation", "final")
REQUIRED_FILES = ("brief.md", "deck_narrative.md")
LEGACY_HINT_DIRS = ("brief", "plan", "content")

ASSET_DIRS = (
    "diagrams",
    "charts",
    "icons",
    "images",
    "tables",
)


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="检查 deck workspace 的关键目录与输入")
    parser.add_argument("--workspace-dir", required=True, type=Path, help="deck workspace 路径")
    parser.add_argument("--json-out", type=Path, help="可选：写出 lint 结果 JSON")
    return parser.parse_args()


def main() -> int:
    """执行 workspace lint。"""
    args = parse_args()
    workspace_dir = args.workspace_dir.resolve()

    if not workspace_dir.exists():
        raise SystemExit(f"workspace 不存在: {workspace_dir}")

    errors: list[str] = []
    warnings: list[str] = []

    required_dir_status: dict[str, bool] = {}
    for name in REQUIRED_DIRS:
        ok = (workspace_dir / name).is_dir()
        required_dir_status[name] = ok
        if not ok:
            errors.append(f"缺少目录: {name}/")

    required_file_status: dict[str, bool] = {}
    for name in REQUIRED_FILES:
        ok = (workspace_dir / name).is_file()
        required_file_status[name] = ok
        if not ok:
            errors.append(f"缺少文件: {name}")

    derived_specs_ok = (workspace_dir / "build" / "generated" / "slide_specs.yaml").exists()
    if not derived_specs_ok:
        warnings.append("缺少 build/generated/slide_specs.yaml，可由 derive_slide_specs_from_narrative.py 派生")

    legacy_dirs = [name for name in LEGACY_HINT_DIRS if (workspace_dir / name).exists()]
    if legacy_dirs:
        warnings.append("检测到 legacy 文档层: " + ", ".join(f"{name}/" for name in legacy_dirs))

    asset_counts: dict[str, int] = {}
    assets_dir = workspace_dir / "assets"
    for name in ASSET_DIRS:
        subdir = assets_dir / name
        if subdir.is_dir():
            asset_counts[name] = sum(1 for path in subdir.iterdir() if path.is_file())
        else:
            asset_counts[name] = 0
            warnings.append(f"缺少 assets/{name}/ 或该目录为空")

    result = {
        "workspace": str(workspace_dir),
        "required_dirs": required_dir_status,
        "required_files": required_file_status,
        "derived_slide_specs": derived_specs_ok,
        "legacy_dirs": legacy_dirs,
        "asset_counts": asset_counts,
        "errors": errors,
        "warnings": warnings,
    }

    print(f"[INFO] workspace={workspace_dir}")
    print("[INFO] required_files=" + ", ".join(f"{k}:{v}" for k, v in required_file_status.items()))
    print(f"[INFO] derived_slide_specs={derived_specs_ok}")
    print("[INFO] asset_counts=" + ", ".join(f"{k}:{v}" for k, v in asset_counts.items()))

    for warning in warnings:
        print(f"[WARN] {warning}")
    for error in errors:
        print(f"[ERROR] {error}")

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[INFO] 写入 JSON: {args.json_out}")

    if errors:
        print(f"[FAIL] workspace lint 未通过，错误数: {len(errors)}")
        return 1

    print("[OK] workspace lint 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
