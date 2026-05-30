#!/usr/bin/env python3
"""初始化 `word-polished-doc-collab` 的轻量或精细工作区。

定位与作用
----------
这个脚本负责把高频、机械、容易出错的建目录和抄样板动作收敛成一次命令。
它不会覆盖已有内容，也不会替用户脑补复杂资产，只负责生成最小且可执行的
workspace 骨架与 Markdown / meta 样板。
"""

from __future__ import annotations

import argparse
import base64
from pathlib import Path

from word_skill_tools import build_markdown_template
from word_skill_tools import get_style_profile
from word_skill_tools import write_json


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""

    parser = argparse.ArgumentParser(description="初始化 Word polished doc 协作工作区")
    parser.add_argument("workspace_dir", type=Path, help="目标工作区目录")
    parser.add_argument("--mode", choices=["lightweight", "refined"], default="refined", help="工作区模式")
    parser.add_argument("--doc-slug", required=True, help="文档 slug，例如 `board_report`")
    parser.add_argument("--title", help="文档标题；默认根据 slug 自动生成")
    parser.add_argument(
        "--style-profile",
        default="cn_song_times",
        help="初始化时写入的 style profile；默认 `cn_song_times`",
    )
    parser.add_argument(
        "--with-asset-manifest",
        action="store_true",
        help="仅在明确需要复杂视觉资产时初始化空的 asset_manifest.json",
    )
    return parser.parse_args()


def main() -> int:
    """执行工作区初始化。"""

    args = parse_args()
    workspace_dir = args.workspace_dir.resolve()
    if workspace_dir.exists() and any(workspace_dir.iterdir()):
        raise SystemExit(f"目标目录已存在且非空，拒绝覆盖：{workspace_dir}")

    profile = get_style_profile(args.style_profile)
    title = args.title or prettify_slug(args.doc_slug)

    if args.mode == "lightweight":
        initialize_lightweight_workspace(workspace_dir, args.doc_slug, title, profile.name)
    else:
        initialize_refined_workspace(
            workspace_dir=workspace_dir,
            doc_slug=args.doc_slug,
            title=title,
            profile_name=profile.name,
            with_asset_manifest=args.with_asset_manifest,
        )

    print(f"[OK] 已初始化 {args.mode} 工作区：{workspace_dir}")
    return 0


def initialize_lightweight_workspace(workspace_dir: Path, doc_slug: str, title: str, profile_name: str) -> None:
    """初始化轻量模式工作区。"""

    assets_dir = workspace_dir / "assets"
    out_dir = workspace_dir / "out"
    markdown_path = workspace_dir / "doc.md"

    assets_dir.mkdir(parents=True, exist_ok=False)
    out_dir.mkdir(parents=True, exist_ok=False)
    markdown_path.write_text(
        build_markdown_template(title, profile_name, mode="lightweight", include_figure_example=False),
        encoding="utf-8",
    )

    readme_path = workspace_dir / "README.md"
    readme_path.write_text(
        "\n".join(
            [
                f"# {title}",
                "",
                "这个工作区由 `word-polished-doc-collab/scripts/init_doc_workspace.py` 初始化。",
                "",
                "## 结构",
                "",
                "```text",
                f"{workspace_dir.name}/",
                "├── assets/",
                "├── doc.md",
                "└── out/",
                "```",
                "",
                "## 说明",
                "",
                "- 轻量模式默认不要求 `meta.json`、`asset_manifest.json` 和自动 QA。",
                "- 如果后续需求升级为正式报告、复杂图表、preset 或强制 review，请迁移到 refined workspace。",
                "",
                "## 典型命令",
                "",
                "```bash",
                "python <path-to-word-skill>/scripts/build_docx.py \\",
                "  --markdown doc.md \\",
                f"  --output out/{doc_slug}.docx \\",
                f"  --style-profile {profile_name}",
                "```",
                "",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def initialize_refined_workspace(
    workspace_dir: Path,
    doc_slug: str,
    title: str,
    profile_name: str,
    with_asset_manifest: bool,
) -> None:
    """初始化精细模式工作区。"""

    original_dir = workspace_dir / "original"
    markdown_dir = workspace_dir / "markdown" / doc_slug
    assets_dir = markdown_dir / "assets"
    build_dir = workspace_dir / "build" / "docx"
    temp_preview_dir = workspace_dir / "temp" / "preview" / "pages"
    temp_qa_dir = workspace_dir / "temp" / "qa"
    local_scripts_dir = workspace_dir / "scripts"

    for directory in (original_dir, assets_dir, build_dir, temp_preview_dir, temp_qa_dir, local_scripts_dir):
        directory.mkdir(parents=True, exist_ok=False)

    markdown_path = markdown_dir / f"{doc_slug}.md"
    markdown_path.write_text(
        build_markdown_template(
            title,
            profile_name,
            mode="refined",
            include_figure_example=with_asset_manifest,
        ),
        encoding="utf-8",
    )

    meta_path = markdown_dir / "meta.json"
    write_json(
        meta_path,
        {
            "source_docx": None,
            "markdown_file": f"markdown/{doc_slug}/{doc_slug}.md",
            "assets_dir": f"markdown/{doc_slug}/assets",
            "output_docx": f"build/docx/{doc_slug}.docx",
            "style_profile": profile_name,
            "workflow_mode": "refined",
        },
    )

    if with_asset_manifest:
        placeholder_path = assets_dir / "placeholder.png"
        write_placeholder_png(placeholder_path)
        write_json(
            markdown_dir / "asset_manifest.json",
            {
                "assets": [
                    {
                        "asset_id": "placeholder_figure_1",
                        "asset_mode": "static_image",
                        "source_file": "assets/placeholder.png",
                        "caption_position": profile_name_to_caption_position(profile_name),
                        "figure_note": "Replace with the figure note.",
                        "source_note": "Replace with the source note.",
                        "editable_required": False,
                    }
                ]
            },
        )

    (local_scripts_dir / "README.md").write_text(
        "\n".join(
            [
                "# Local Scripts",
                "",
                "这个目录预留给宿主项目自己的构建脚本、资产生成脚本或包装命令。",
                "如果当前只打算直接调用 skill 内的参考脚本，也可以先保持为空。",
                "",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    readme_path = workspace_dir / "README.md"
    readme_path.write_text(
        "\n".join(
            [
                f"# {title}",
                "",
                "这个 refined workspace 由 `word-polished-doc-collab/scripts/init_doc_workspace.py` 初始化。",
                "",
                "## 结构",
                "",
                "```text",
                f"{workspace_dir.name}/",
                "├── original/",
                "├── markdown/",
                f"│   └── {doc_slug}/",
                f"│       ├── {doc_slug}.md",
                "│       ├── assets/",
                "│       ├── meta.json",
                "│       └── [asset_manifest.json]",
                "├── build/docx/",
                "├── scripts/",
                "└── temp/",
                "```",
                "",
                "## 当前配置",
                "",
                f"- style profile：`{profile_name}`",
                "- workflow mode：`refined`",
                "",
                "## 典型命令",
                "",
                "```bash",
                "python <path-to-word-skill>/scripts/lint_doc_markdown.py \\",
                f"  --meta markdown/{doc_slug}/meta.json",
                "",
                "python <path-to-word-skill>/scripts/build_docx.py \\",
                f"  --meta markdown/{doc_slug}/meta.json",
                "",
                "python <path-to-word-skill>/scripts/export_docx_preview.py \\",
                f"  --meta markdown/{doc_slug}/meta.json",
                "",
                "python <path-to-word-skill>/scripts/run_docx_qa.py \\",
                f"  --meta markdown/{doc_slug}/meta.json",
                "```",
                "",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def prettify_slug(doc_slug: str) -> str:
    """把 slug 转成更适合当标题的文本。"""

    parts = re_split_slug(doc_slug)
    if not parts:
        return doc_slug
    return " ".join(part.capitalize() for part in parts)


def re_split_slug(doc_slug: str) -> list[str]:
    """按常见分隔符切分 slug。"""

    return [part for part in doc_slug.replace("-", "_").split("_") if part]


def write_placeholder_png(path: Path) -> None:
    """写入一张极小占位 PNG，避免初始化后的模板立即构建失败。"""

    png_base64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
        "/w8AAn8B9pJzi9gAAAAASUVORK5CYII="
    )
    path.write_bytes(base64.b64decode(png_base64))


def profile_name_to_caption_position(profile_name: str) -> str:
    """为初始化时的占位资产推断 caption 位置。"""

    profile = get_style_profile(profile_name)
    return profile.figure_title_position


if __name__ == "__main__":
    raise SystemExit(main())
