#!/usr/bin/env python3
"""把 DOCX 导出成 PDF 预览和逐页 PNG。

定位与作用
----------
这个脚本负责把构建产物变成可复核的 preview evidence。
它不会尝试做审美判断，只负责把 `.docx` 稳定导出为 `.pdf` 和逐页 `.png`，
供人工 visual review 或后续脚本化检查使用。
"""

from __future__ import annotations

import argparse
from pathlib import Path

from word_skill_tools import export_docx_preview
from word_skill_tools import guess_preview_dir
from word_skill_tools import resolve_standard_context
from word_skill_tools import write_json


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""

    parser = argparse.ArgumentParser(description="把 DOCX 导出成 PDF 和逐页 PNG")
    parser.add_argument("--meta", type=Path, help="可选：标准 refined workspace 中的 meta.json")
    parser.add_argument("--docx", type=Path, help="可选：直接指定输入 DOCX")
    parser.add_argument("--preview-dir", type=Path, help="可选：预览输出目录；默认自动推断")
    parser.add_argument("--png-prefix", default="page", help="逐页 PNG 的文件名前缀")
    parser.add_argument("--dpi", type=int, default=180, help="逐页 PNG 的导出分辨率")
    parser.add_argument("--pdf-only", action="store_true", help="只导出 PDF，不切 PNG")
    parser.add_argument("--json-out", type=Path, help="可选：写出导出摘要 JSON")
    return parser.parse_args()


def main() -> int:
    """执行 preview 导出。"""

    args = parse_args()
    docx_path = resolve_docx_path(args).resolve()
    preview_dir = args.preview_dir.resolve() if args.preview_dir else guess_preview_dir(docx_path)
    result = export_docx_preview(
        docx_path=docx_path,
        preview_dir=preview_dir,
        png_prefix=args.png_prefix,
        dpi=args.dpi,
        export_png=not args.pdf_only,
    )

    print(f"[OK] 预览导出完成：{result['pdf_path']}")
    print(f"[INFO] preview_dir={result['preview_dir']} page_image_count={result['page_image_count']}")
    if args.json_out:
        write_json(args.json_out, result)
        print(f"[INFO] 写入 JSON: {args.json_out}")
    return 0


def resolve_docx_path(args: argparse.Namespace) -> Path:
    """解析输入 DOCX 路径。"""

    if args.docx is not None:
        return args.docx
    if args.meta is None:
        raise SystemExit("必须至少提供 `--docx` 或 `--meta`。")
    context = resolve_standard_context(args.meta.resolve())
    docx_path = context["output_docx"]
    if docx_path is None:
        raise SystemExit("meta.json 没有声明 output_docx。")
    return docx_path


if __name__ == "__main__":
    raise SystemExit(main())
