#!/usr/bin/env python3
"""检查 `ppt-polished-deck-collab` 的环境依赖与可用技术路线。

定位与作用
----------
这个脚本不负责安装依赖，而是负责回答“当前机器上哪些 PPT 技术路线可用”。
它会检查 Python 包、PowerPoint、LibreOffice、Poppler 工具、Mermaid 草稿链路、
Python figure 依赖和原生 Office chart 所需依赖，并给出可用路线摘要，避免 agent
在错误的环境假设上继续工作。
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


POWERPOINT_APP = Path("/Applications/Microsoft PowerPoint.app")
OFFICE_TEMP_DIR = Path.home() / "Library/Group Containers/UBF8T346G9.Office/TemporaryItems"


def _load_env_file_keys(path: Path) -> set[str]:
    """读取 `.env` 中出现过的 key 名，不读取或输出 value。"""
    if not path.exists():
        return set()

    keys: set[str] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if key:
            keys.add(key)
    return keys


def _find_default_env_file(start: Path) -> Path | None:
    """从当前目录向上查找最近的 `.env` 文件。"""
    current = start.resolve()
    for path in (current, *current.parents):
        candidate = path / ".env"
        if candidate.exists():
            return candidate
    return None


def _import_version(module_name: str, version_attr: str = "__version__") -> tuple[bool, str]:
    """尝试导入模块并读取版本信息。"""
    try:
        module = __import__(module_name)
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)

    version = getattr(module, version_attr, "unknown")
    if module_name == "fitz":
        doc = getattr(module, "__doc__", "") or ""
        version = doc.splitlines()[0] if doc else "available"
    return True, str(version)


def _run_version_command(command: list[str]) -> tuple[bool, str]:
    """执行版本命令并返回结果。"""
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)

    output = (completed.stdout or completed.stderr).strip()
    return True, output.splitlines()[0] if output else "available"


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="检查 PPT polished deck skill 的环境与可用路线")
    parser.add_argument(
        "--require-backend",
        choices=["none", "powerpoint", "libreoffice"],
        default="none",
        help="可选：要求某条预览导出 backend 必须可用",
    )
    parser.add_argument("--json-out", type=Path, help="可选：把检查结果写到 JSON")
    return parser.parse_args()


def main() -> int:
    """执行环境检查并输出摘要。"""
    args = parse_args()

    python_ok = True
    python_version = platform.python_version()

    pptx_ok, pptx_version = _import_version("pptx")
    fitz_ok, fitz_version = _import_version("fitz")
    pandas_ok, pandas_version = _import_version("pandas")
    matplotlib_ok, matplotlib_version = _import_version("matplotlib")
    seaborn_ok, seaborn_version = _import_version("seaborn")
    numpy_ok, numpy_version = _import_version("numpy")
    openai_ok, openai_version = _import_version("openai")

    pdftoppm_path = shutil.which("pdftoppm")
    pdftotext_path = shutil.which("pdftotext")
    libreoffice_path = shutil.which("libreoffice") or shutil.which("soffice")
    node_path = shutil.which("node")
    npm_path = shutil.which("npm")
    mmdc_path = shutil.which("mmdc")

    pdftoppm_ok, pdftoppm_version = (
        _run_version_command([pdftoppm_path, "-v"]) if pdftoppm_path else (False, "not found")
    )
    pdftotext_ok, pdftotext_version = (
        _run_version_command([pdftotext_path, "-v"]) if pdftotext_path else (False, "not found")
    )
    libreoffice_ok, libreoffice_version = (
        _run_version_command([libreoffice_path, "--version"]) if libreoffice_path else (False, "not found")
    )
    node_ok, node_version = _run_version_command([node_path, "--version"]) if node_path else (False, "not found")
    npm_ok, npm_version = _run_version_command([npm_path, "--version"]) if npm_path else (False, "not found")
    mmdc_ok, mmdc_version = _run_version_command([mmdc_path, "--version"]) if mmdc_path else (False, "not found")

    powerpoint_ok = POWERPOINT_APP.exists() and OFFICE_TEMP_DIR.exists()
    python_figure_ok = pandas_ok and matplotlib_ok and seaborn_ok and numpy_ok
    office_chart_ok = pptx_ok
    mermaid_draft_ok = node_ok and npm_ok and mmdc_ok
    env_file = _find_default_env_file(Path.cwd())
    env_file_keys = _load_env_file_keys(env_file) if env_file else set()
    api_key_in_shell = bool(os.getenv("OPENAI_API_KEY") or os.getenv("OPENAINEXT_API_KEY"))
    api_key_in_env_file = bool({"OPENAI_API_KEY", "OPENAINEXT_API_KEY"} & env_file_keys)
    base_url_set = bool(
        os.getenv("OPENAI_BASE_URL")
        or os.getenv("OPENAINEXT_API_BASE")
        or {"OPENAI_BASE_URL", "OPENAINEXT_API_BASE"} & env_file_keys
    )
    image_generation_api_ok = openai_ok and (api_key_in_shell or api_key_in_env_file)

    available_routes: list[str] = []
    if pptx_ok:
        available_routes.append("editable_pptx")
    if office_chart_ok:
        available_routes.append("office_chart_native")
    if python_figure_ok:
        available_routes.append("python_figure_image")
    if powerpoint_ok and (pdftoppm_ok or fitz_ok):
        available_routes.append("preview_powerpoint")
    if libreoffice_ok and (pdftoppm_ok or fitz_ok):
        available_routes.append("preview_libreoffice")
    if pptx_ok:
        available_routes.append("diagram_connector_check")
        available_routes.append("diagram_visual")
    if mermaid_draft_ok:
        available_routes.append("diagram_mermaid_draft")
    if image_generation_api_ok:
        available_routes.append("image_generation_api")

    result = {
        "system": {
            "platform": platform.platform(),
            "python": python_version,
        },
        "python_modules": {
            "python-pptx": {"ok": pptx_ok, "detail": pptx_version},
            "fitz": {"ok": fitz_ok, "detail": fitz_version},
            "pandas": {"ok": pandas_ok, "detail": pandas_version},
            "matplotlib": {"ok": matplotlib_ok, "detail": matplotlib_version},
            "seaborn": {"ok": seaborn_ok, "detail": seaborn_version},
            "numpy": {"ok": numpy_ok, "detail": numpy_version},
            "openai": {"ok": openai_ok, "detail": openai_version},
        },
        "tools": {
            "pdftoppm": {"ok": pdftoppm_ok, "detail": pdftoppm_version},
            "pdftotext": {"ok": pdftotext_ok, "detail": pdftotext_version},
            "libreoffice": {"ok": libreoffice_ok, "detail": libreoffice_version},
            "node": {"ok": node_ok, "detail": node_version},
            "npm": {"ok": npm_ok, "detail": npm_version},
            "mmdc": {"ok": mmdc_ok, "detail": mmdc_version},
            "powerpoint_app": {"ok": POWERPOINT_APP.exists(), "detail": str(POWERPOINT_APP)},
            "office_temp_dir": {"ok": OFFICE_TEMP_DIR.exists(), "detail": str(OFFICE_TEMP_DIR)},
        },
        "api_backends": {
            "image_generation_api": {
                "ok": image_generation_api_ok,
                "openai_sdk": openai_ok,
                "api_key_source": "shell" if api_key_in_shell else (".env" if api_key_in_env_file else "not found"),
                "base_url_set": base_url_set,
                "env_file": str(env_file) if env_file else None,
            }
        },
        "routes": available_routes,
    }

    print(f"[INFO] Python: ok={python_ok} version={python_version}")
    print(f"[INFO] python-pptx: ok={pptx_ok} detail={pptx_version}")
    print(f"[INFO] fitz: ok={fitz_ok} detail={fitz_version}")
    print(f"[INFO] pandas: ok={pandas_ok} detail={pandas_version}")
    print(f"[INFO] matplotlib: ok={matplotlib_ok} detail={matplotlib_version}")
    print(f"[INFO] seaborn: ok={seaborn_ok} detail={seaborn_version}")
    print(f"[INFO] numpy: ok={numpy_ok} detail={numpy_version}")
    print(f"[INFO] openai: ok={openai_ok} detail={openai_version}")
    print(f"[INFO] pdftoppm: ok={pdftoppm_ok} detail={pdftoppm_version}")
    print(f"[INFO] pdftotext: ok={pdftotext_ok} detail={pdftotext_version}")
    print(f"[INFO] libreoffice: ok={libreoffice_ok} detail={libreoffice_version}")
    print(f"[INFO] node: ok={node_ok} detail={node_version}")
    print(f"[INFO] npm: ok={npm_ok} detail={npm_version}")
    print(f"[INFO] mmdc: ok={mmdc_ok} detail={mmdc_version}")
    print(f"[INFO] powerpoint_preview: ok={powerpoint_ok} app={POWERPOINT_APP.exists()} temp={OFFICE_TEMP_DIR.exists()}")
    print(
        "[INFO] image_generation_api: "
        f"ok={image_generation_api_ok} key_source={result['api_backends']['image_generation_api']['api_key_source']} "
        f"base_url_set={base_url_set}"
    )
    print(f"[INFO] available_routes: {', '.join(available_routes) if available_routes else '(none)'}")

    failed = False
    if not pptx_ok:
        failed = True

    if args.require_backend == "powerpoint" and "preview_powerpoint" not in available_routes:
        print("[ERROR] 当前环境不满足 PowerPoint 预览导出路线")
        failed = True
    if args.require_backend == "libreoffice" and "preview_libreoffice" not in available_routes:
        print("[ERROR] 当前环境不满足 LibreOffice 预览导出路线")
        failed = True

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[INFO] 写入 JSON: {args.json_out}")

    if failed:
        print("[FAIL] 环境检查未通过")
        return 1

    print("[OK] 环境检查通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
