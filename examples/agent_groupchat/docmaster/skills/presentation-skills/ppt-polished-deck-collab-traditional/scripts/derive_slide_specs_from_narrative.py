#!/usr/bin/env python3
"""从总叙事文档派生 deck 级结构化 slide specs。

定位与作用
----------
这个脚本服务新的 `ppt-polished-deck-collab` 默认 workspace 结构：
人类长期维护 `brief.md` 与 `deck_narrative.md` 两份主文档，
机器执行入口则由 `deck_narrative.md` 自动派生出 `slide_specs.yaml`。

大致流程
----------
1. 读取 `deck_narrative.md` 的 YAML frontmatter，获取 deck 级元信息；
2. 按 `### Sxx | <title>` 解析每页 section；
3. 从每页 section 中抽取第一个 YAML code block 作为机器执行 spec；
4. 将剩余 markdown 作为 `narrative_markdown` 附带写出；
5. 输出统一的 `slide_specs.yaml`，供 build 与 lint 使用。
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import yaml

FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n?", re.DOTALL)
SLIDE_HEADING_RE = re.compile(r"^###\s+(S\d+)(?:\s*\|\s*(.+))?\s*$", re.MULTILINE)
YAML_BLOCK_RE = re.compile(r"```yaml(?:\s+slide_spec)?\n(.*?)\n```", re.DOTALL)

REQUIRED_SLIDE_FIELDS = (
    "title",
    "reader_question",
    "page_task",
    "reading_mode",
    "archetype",
    "asset_mode",
    "validation_mode",
    "key_message",
)


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="从总叙事文档派生 slide_specs.yaml")
    parser.add_argument("--narrative", required=True, type=Path, help="输入 deck_narrative.md")
    parser.add_argument("--out-yaml", required=True, type=Path, help="输出 slide_specs.yaml")
    parser.add_argument("--json-out", type=Path, help="可选：写出结构化解析结果 JSON")
    return parser.parse_args()


def split_frontmatter(text: str) -> tuple[dict, str]:
    """分离 YAML frontmatter 与正文。"""
    match = FRONTMATTER_RE.match(text)
    if not match:
        raise ValueError("缺少 YAML frontmatter")

    frontmatter = yaml.safe_load(match.group(1)) or {}
    if not isinstance(frontmatter, dict):
        raise ValueError("frontmatter 顶层必须是 mapping")
    body = text[match.end() :]
    return frontmatter, body


def extract_slide_sections(body: str) -> list[tuple[str, str | None, str]]:
    """提取 `### Sxx` slide sections。"""
    matches = list(SLIDE_HEADING_RE.finditer(body))
    if not matches:
        raise ValueError("未找到任何 `### Sxx` slide section")

    sections: list[tuple[str, str | None, str]] = []
    for index, match in enumerate(matches):
        slide_id = match.group(1)
        title_hint = match.group(2).strip() if match.group(2) else None
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        section_body = body[start:end].strip()
        sections.append((slide_id, title_hint, section_body))
    return sections


def parse_slide_section(slide_id: str, title_hint: str | None, section_body: str) -> dict:
    """解析单个 slide section。"""
    yaml_match = YAML_BLOCK_RE.search(section_body)
    if not yaml_match:
        raise ValueError(f"{slide_id}: 缺少 YAML slide_spec block")

    slide_spec = yaml.safe_load(yaml_match.group(1)) or {}
    if not isinstance(slide_spec, dict):
        raise ValueError(f"{slide_id}: YAML slide_spec 必须是 mapping")

    slide_spec.setdefault("slide_id", slide_id)
    if slide_spec["slide_id"] != slide_id:
        raise ValueError(f"{slide_id}: heading 与 YAML 中的 slide_id 不一致")

    if title_hint and "title" not in slide_spec:
        slide_spec["title"] = title_hint

    missing = [field for field in REQUIRED_SLIDE_FIELDS if field not in slide_spec]
    if missing:
        raise ValueError(f"{slide_id}: 缺少字段 {', '.join(missing)}")

    remaining = (section_body[: yaml_match.start()] + section_body[yaml_match.end() :]).strip()
    if remaining:
        slide_spec["narrative_markdown"] = remaining

    return slide_spec


def main() -> int:
    """执行 narrative -> slide_specs 派生。"""
    args = parse_args()
    narrative_path = args.narrative.resolve()
    out_yaml = args.out_yaml.resolve()

    if not narrative_path.exists():
        raise SystemExit(f"未找到 narrative 文档: {narrative_path}")

    frontmatter, body = split_frontmatter(narrative_path.read_text(encoding="utf-8"))
    deck = frontmatter.get("deck")
    if not isinstance(deck, dict):
        raise SystemExit("frontmatter 中缺少 `deck` mapping")

    slide_sections = extract_slide_sections(body)
    slides = [parse_slide_section(slide_id, title_hint, section_body) for slide_id, title_hint, section_body in slide_sections]
    result = {"deck": deck, "slides": slides}

    out_yaml.parent.mkdir(parents=True, exist_ok=True)
    out_yaml.write_text(yaml.safe_dump(result, allow_unicode=True, sort_keys=False), encoding="utf-8")
    print(f"[OK] 已写出派生 slide specs: {out_yaml}")

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[INFO] 已写出 JSON: {args.json_out}")

    print(f"[INFO] slides={len(slides)} deck_title={deck.get('title', '')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
