#!/usr/bin/env python3
"""对 Word skill 的 Markdown 源做结构和语义 lint。

定位与作用
----------
这个脚本负责在构建前回答“这份 Markdown 作为文档源是否已经干净到值得继续 build”。
它检查标题层级、caption 语义、图片路径、语言契约和 `asset_manifest` 一致性，
优先把问题拦在源头，而不是等到 DOCX 产物里再找。
"""

from __future__ import annotations

import argparse
from pathlib import Path

from word_skill_tools import infer_workspace_root
from word_skill_tools import lint_markdown_source
from word_skill_tools import load_meta
from word_skill_tools import report_to_markdown
from word_skill_tools import resolve_standard_context
from word_skill_tools import write_json


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""

    parser = argparse.ArgumentParser(description="对 Markdown 文档源执行 word skill 语义 lint")
    parser.add_argument("--meta", type=Path, help="可选：标准 refined workspace 中的 meta.json")
    parser.add_argument("--markdown", type=Path, help="可选：直接指定 Markdown 文件")
    parser.add_argument("--style-profile", help="可选：显式指定 style profile")
    parser.add_argument("--workflow-mode", choices=["lightweight", "refined"], help="可选：显式指定 workflow mode")
    parser.add_argument("--asset-manifest", type=Path, help="可选：显式指定 asset_manifest.json")
    parser.add_argument("--json-out", type=Path, help="可选：写出 JSON 报告")
    parser.add_argument("--md-out", type=Path, help="可选：写出 Markdown 报告")
    parser.add_argument("--fail-on-warning", action="store_true", help="如果存在 warning，也返回非零 exit code")
    return parser.parse_args()


def main() -> int:
    """执行 Markdown lint。"""

    args = parse_args()
    markdown_path, profile_name, workflow_mode, asset_manifest_path = resolve_inputs(args)

    report = lint_markdown_source(
        markdown_path=markdown_path,
        profile_name=profile_name,
        workflow_mode=workflow_mode,
        asset_manifest_path=asset_manifest_path,
    )

    json_out = args.json_out or default_report_path(markdown_path, "markdown_lint.json")
    md_out = args.md_out or default_report_path(markdown_path, "markdown_lint.md")
    write_json(json_out, report)
    md_out.write_text(report_to_markdown("Markdown Lint Report", report) + "\n", encoding="utf-8")

    print(f"[INFO] markdown={markdown_path}")
    print(f"[INFO] style_profile={profile_name} workflow_mode={workflow_mode}")
    print(f"[INFO] json_report={json_out}")
    print(f"[INFO] markdown_report={md_out}")

    error_count = sum(1 for issue in report["issues"] if issue["severity"] == "error")
    warning_count = sum(1 for issue in report["issues"] if issue["severity"] == "warning")
    print(f"[INFO] issue_count={report['issue_count']} errors={error_count} warnings={warning_count}")

    if error_count > 0 or (args.fail_on_warning and warning_count > 0):
        print("[FAIL] Markdown lint 未通过")
        return 1
    print("[OK] Markdown lint 通过")
    return 0


def resolve_inputs(args: argparse.Namespace) -> tuple[Path, str, str, Path | None]:
    """解析 lint 所需的输入上下文。"""

    if args.meta is None and args.markdown is None:
        raise SystemExit("必须至少提供 `--meta` 或 `--markdown`。")

    markdown_path = args.markdown.resolve() if args.markdown else None
    asset_manifest_path = args.asset_manifest.resolve() if args.asset_manifest else None
    profile_name = args.style_profile
    workflow_mode = args.workflow_mode

    if args.meta is not None:
        meta_path = args.meta.resolve()
        context = resolve_standard_context(meta_path)
        meta = load_meta(meta_path)
        markdown_path = markdown_path or context["markdown_path"]
        asset_manifest_path = asset_manifest_path or context["asset_manifest_path"]
        profile_name = profile_name or str(meta.get("style_profile", "cn_song_times"))
        workflow_mode = workflow_mode or str(meta.get("workflow_mode", "refined"))

    if markdown_path is None:
        raise SystemExit("无法解析 Markdown 路径。")
    return markdown_path, profile_name or "cn_song_times", workflow_mode or "refined", asset_manifest_path


def default_report_path(markdown_path: Path, filename: str) -> Path:
    """按标准目录猜测 lint 报告路径。"""

    resolved = markdown_path.resolve()
    if len(resolved.parents) >= 3 and resolved.parents[1].name == "markdown":
        return resolved.parents[2] / "temp" / "qa" / filename
    return resolved.parent / filename


if __name__ == "__main__":
    raise SystemExit(main())
