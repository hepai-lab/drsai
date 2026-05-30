#!/usr/bin/env python3
"""检查 `word-polished-doc-collab` 的环境依赖与可用路线。

定位与作用
----------
这个脚本不负责安装依赖，而是负责回答“当前机器上这套 Word 流程到底能走到哪”。
它会检查 Python 包、LibreOffice / Poppler / Pandoc 和常用字体探测能力，并给出
可用路线摘要，避免 agent 在错误环境假设上继续构建或 QA。
"""

from __future__ import annotations

import argparse
import json
import platform
from pathlib import Path
import shutil
import subprocess

from word_skill_tools import SUPPORTED_FONTS


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""

    parser = argparse.ArgumentParser(description="检查 word-polished-doc-collab 的环境依赖")
    parser.add_argument("--json-out", type=Path, help="可选：把检查结果写到 JSON")
    parser.add_argument(
        "--require-preview",
        action="store_true",
        help="如果当前环境不能导出 DOCX preview，则返回非零 exit code",
    )
    return parser.parse_args()


def main() -> int:
    """执行环境检查。"""

    args = parse_args()

    python_docx_ok, python_docx_detail = try_import("docx")
    lxml_ok, lxml_detail = try_import("lxml")
    tools = {
        "soffice": probe_binary(["soffice", "--version"]),
        "libreoffice": probe_binary(["libreoffice", "--version"]),
        "pdftoppm": probe_binary(["pdftoppm", "-v"]),
        "pdftotext": probe_binary(["pdftotext", "-v"]),
        "pandoc": probe_binary(["pandoc", "--version"]),
        "fc-match": probe_binary(["fc-match", "--version"]),
    }
    fonts = probe_fonts(SUPPORTED_FONTS, tools["fc-match"]["ok"])

    preview_route = (tools["soffice"]["ok"] or tools["libreoffice"]["ok"]) and tools["pdftoppm"]["ok"]
    available_routes: list[str] = []
    if python_docx_ok:
        available_routes.append("markdown_docx_build")
        available_routes.append("docx_style_qa")
    if preview_route:
        available_routes.append("docx_pdf_png_preview")
    if tools["pdftotext"]["ok"]:
        available_routes.append("pdf_text_extract_review")
    if tools["pandoc"]["ok"]:
        available_routes.append("pandoc_docx_markdown")

    result = {
        "system": {
            "platform": platform.platform(),
            "python": platform.python_version(),
        },
        "python_modules": {
            "python-docx": {"ok": python_docx_ok, "detail": python_docx_detail},
            "lxml": {"ok": lxml_ok, "detail": lxml_detail},
        },
        "tools": tools,
        "fonts": fonts,
        "routes": available_routes,
    }

    print(f"[INFO] python-docx: ok={python_docx_ok} detail={python_docx_detail}")
    print(f"[INFO] lxml: ok={lxml_ok} detail={lxml_detail}")
    for tool_name, probe in tools.items():
        print(f"[INFO] {tool_name}: ok={probe['ok']} detail={probe['detail']}")
    print(f"[INFO] available_routes: {', '.join(available_routes) if available_routes else '(none)'}")

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[INFO] 写入 JSON: {args.json_out}")

    failed = False
    if not python_docx_ok:
        print("[ERROR] 当前环境缺少 `python-docx`，无法执行 Markdown -> DOCX 构建路线")
        failed = True
    if args.require_preview and not preview_route:
        print("[ERROR] 当前环境不满足 DOCX -> PDF -> PNG 预览导出路线")
        failed = True

    if failed:
        print("[FAIL] 环境检查未通过")
        return 1
    print("[OK] 环境检查通过")
    return 0


def try_import(module_name: str) -> tuple[bool, str]:
    """尝试导入模块并读取版本信息。"""

    try:
        module = __import__(module_name)
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)
    return True, str(getattr(module, "__version__", "available"))


def probe_binary(command: list[str]) -> dict[str, str | bool]:
    """探测命令行工具是否存在。"""

    binary_name = command[0]
    binary_path = shutil.which(binary_name)
    if binary_path is None:
        return {"ok": False, "detail": "not found"}
    try:
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "detail": str(exc)}
    output = (completed.stdout or completed.stderr).strip()
    first_line = output.splitlines()[0] if output else str(binary_path)
    return {"ok": True, "detail": first_line}


def probe_fonts(font_names: list[str], can_probe: bool) -> dict[str, dict[str, str | bool]]:
    """探测关键字体是否可解析。"""

    results: dict[str, dict[str, str | bool]] = {}
    for font_name in font_names:
        if not can_probe:
            results[font_name] = {"ok": False, "detail": "fc-match unavailable"}
            continue
        try:
            completed = subprocess.run(
                ["fc-match", font_name],
                check=True,
                capture_output=True,
                text=True,
            )
        except Exception as exc:  # noqa: BLE001
            results[font_name] = {"ok": False, "detail": str(exc)}
            continue
        results[font_name] = {"ok": True, "detail": completed.stdout.strip()}
    return results


if __name__ == "__main__":
    raise SystemExit(main())
