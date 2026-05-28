#!/usr/bin/env python3
"""把受控 Markdown 源构建成正式 DOCX。

定位与作用
----------
这个脚本是 `word-polished-doc-collab` 的最小参考构建入口。
它只做一件事：读取 Markdown 和 active `style_profile`，稳定地生成 `.docx`，
并把字体槽位、caption 位置、表格对齐和基础分栏规则集中落到构建阶段。
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from word_skill_tools import build_docx_from_markdown
from word_skill_tools import load_meta
from word_skill_tools import resolve_standard_context
from word_skill_tools import write_json


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""

    parser = argparse.ArgumentParser(description="把 Markdown 构建成正式 DOCX")
    parser.add_argument("--meta", type=Path, help="可选：标准 refined workspace 中的 meta.json")
    parser.add_argument("--markdown", type=Path, help="可选：直接指定 Markdown 文件")
    parser.add_argument("--output", type=Path, help="可选：直接指定输出 DOCX 路径")
    parser.add_argument("--style-profile", help="可选：显式指定 style profile")
    parser.add_argument("--json-out", type=Path, help="可选：写出构建摘要 JSON")
    return parser.parse_args()


def main() -> int:
    """执行 DOCX 构建。"""

    args = parse_args()
    markdown_path, output_path, profile_name = resolve_inputs(args)
    blocks = build_docx_from_markdown(markdown_path=markdown_path, output_path=output_path, profile_name=profile_name)

    role_counter = Counter(block.role for block in blocks)
    summary = {
        "markdown_path": str(markdown_path),
        "output_docx": str(output_path),
        "style_profile": profile_name,
        "block_count": len(blocks),
        "block_roles": dict(role_counter),
    }

    print(f"[OK] 构建完成：{output_path}")
    print(f"[INFO] style_profile={profile_name} block_count={len(blocks)} roles={dict(role_counter)}")

    if args.json_out:
        write_json(args.json_out, summary)
        print(f"[INFO] 写入 JSON: {args.json_out}")
    return 0


def resolve_inputs(args: argparse.Namespace) -> tuple[Path, Path, str]:
    """解析构建所需的 Markdown、输出路径和 profile。"""

    if args.meta is None and (args.markdown is None or args.output is None):
        raise SystemExit("未提供 `--meta` 时，必须同时提供 `--markdown` 与 `--output`。")

    markdown_path = args.markdown.resolve() if args.markdown else None
    output_path = args.output.resolve() if args.output else None
    profile_name = args.style_profile

    if args.meta is not None:
        meta_path = args.meta.resolve()
        meta = load_meta(meta_path)
        context = resolve_standard_context(meta_path)
        markdown_path = markdown_path or context["markdown_path"]
        output_path = output_path or context["output_docx"]
        profile_name = profile_name or str(meta.get("style_profile", "cn_song_times"))

    if markdown_path is None or output_path is None:
        raise SystemExit("无法解析 Markdown 或输出路径。")
    return markdown_path, output_path, profile_name or "cn_song_times"


if __name__ == "__main__":
    raise SystemExit(main())
