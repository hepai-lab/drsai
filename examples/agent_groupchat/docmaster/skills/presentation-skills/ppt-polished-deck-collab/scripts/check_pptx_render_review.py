#!/usr/bin/env python3
"""检查 PPTX 预览图中的边界触墨与成图级风险。

定位与作用
----------
这个脚本服务 `ppt-polished-deck-collab` 的 `render_review` gate。
它只处理结构预检看不到或不够稳的成图级问题，当前首期聚焦两类结果：
1. `boundary_touch_ink`
2. `flattened_graphic_internal_text_requires_review`

这不是 OCR 终检的完整版，但已经为后续 PNG / OCR 扩展预留了统一入口。
"""

from __future__ import annotations

import argparse
import json
from collections import deque
from dataclasses import asdict
from pathlib import Path

from PIL import Image
from pptx import Presentation

from ppt_quality_helpers import (
    QualityIssue,
    collect_shape_inventory,
    collect_text_items,
    estimate_text_layout_metrics,
    resolve_gate_report_paths,
    write_issue_bundle,
)

STRIP_PX = 3
DARK_THRESHOLD = 160
MIN_COMPONENT_AREA = 6
MIN_DARK_RATIO = 0.02


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="检查 PPTX 预览图中的边界触墨与成图级风险")
    parser.add_argument("--pptx", required=True, type=Path, help="输入 PPTX")
    parser.add_argument("--preview-dir", required=True, type=Path, help="逐页预览图目录")
    parser.add_argument("--workspace-dir", type=Path, help="可选：按标准 validation 目录写入带时间戳报告")
    parser.add_argument("--json-out", type=Path, help="可选：写出 JSON 报告")
    parser.add_argument("--md-out", type=Path, help="可选：写出 Markdown 报告")
    parser.add_argument(
        "--fail-on",
        choices=["error", "warning", "never"],
        default="error",
        help="达到哪个严重级别时返回非零 exit code",
    )
    return parser.parse_args()


def slide_preview_path(preview_dir: Path, slide_number: int) -> Path:
    """返回标准命名的预览图路径。"""
    return preview_dir / f"slide_{slide_number:03d}.png"


def rect_pt_to_px(rect, scale_x: float, scale_y: float, image_size: tuple[int, int]) -> tuple[int, int, int, int]:
    """把 pt 矩形映射到像素矩形。"""
    left = max(0, min(image_size[0], round(rect.left * scale_x)))
    top = max(0, min(image_size[1], round(rect.top * scale_y)))
    right = max(0, min(image_size[0], round(rect.right * scale_x)))
    bottom = max(0, min(image_size[1], round(rect.bottom * scale_y)))
    return left, top, right, bottom


def binary_mask_from_crop(image: Image.Image) -> list[list[int]]:
    """把 crop 转成简单二值 mask。"""
    gray = image.convert("L")
    width, height = gray.size
    pixels = list(gray.getdata())
    mask: list[list[int]] = []
    for row in range(height):
        start = row * width
        mask.append([1 if value < DARK_THRESHOLD else 0 for value in pixels[start : start + width]])
    return mask


def mask_dark_ratio(mask: list[list[int]]) -> float:
    """返回黑像素比例。"""
    total = sum(len(row) for row in mask)
    if total == 0:
        return 0.0
    dark = sum(sum(row) for row in mask)
    return round(dark / total, 4)


def max_connected_component_area(mask: list[list[int]]) -> int:
    """返回最大连通域面积。"""
    if not mask or not mask[0]:
        return 0
    height = len(mask)
    width = len(mask[0])
    visited = [[False] * width for _ in range(height)]
    max_area = 0

    for y in range(height):
        for x in range(width):
            if mask[y][x] == 0 or visited[y][x]:
                continue
            queue = deque([(x, y)])
            visited[y][x] = True
            area = 0
            while queue:
                cx, cy = queue.popleft()
                area += 1
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < width and 0 <= ny < height and not visited[ny][nx] and mask[ny][nx] == 1:
                        visited[ny][nx] = True
                        queue.append((nx, ny))
            max_area = max(max_area, area)
    return max_area


def analyze_strip(crop: Image.Image) -> dict:
    """分析边界 strip 的触墨情况。"""
    mask = binary_mask_from_crop(crop)
    return {
        "dark_ratio": mask_dark_ratio(mask),
        "max_component_area": max_connected_component_area(mask),
        "width_px": crop.size[0],
        "height_px": crop.size[1],
    }


def should_flag_strip(result: dict) -> bool:
    """判断 strip 是否构成边界触墨风险。"""
    return result["dark_ratio"] >= MIN_DARK_RATIO and result["max_component_area"] >= MIN_COMPONENT_AREA


def main() -> int:
    """执行 render review。"""
    args = parse_args()
    pptx_path = args.pptx.resolve()
    preview_dir = args.preview_dir.resolve()
    if not pptx_path.exists():
        raise SystemExit(f"未找到 PPTX: {pptx_path}")
    if not preview_dir.exists():
        raise SystemExit(f"未找到预览目录: {preview_dir}")
    json_out, md_out, generated_at = resolve_gate_report_paths(
        gate_name="render_review",
        workspace_dir=args.workspace_dir,
        json_out=args.json_out,
        md_out=args.md_out,
    )

    prs = Presentation(pptx_path)
    slide_width_pt = prs.slide_width.pt
    slide_height_pt = prs.slide_height.pt
    shape_inventory = collect_shape_inventory(prs)
    text_items = collect_text_items(prs)
    issues: list[QualityIssue] = []

    preview_cache: dict[int, Image.Image] = {}

    def load_preview(slide_number: int) -> Image.Image | None:
        if slide_number in preview_cache:
            return preview_cache[slide_number]
        path = slide_preview_path(preview_dir, slide_number)
        if not path.exists():
            return None
        preview_cache[slide_number] = Image.open(path)
        return preview_cache[slide_number]

    for text_item in text_items:
        metrics = estimate_text_layout_metrics(
            text_item.inner_rect_pt,
            text_item.text,
            text_item.font_size_pt,
            text_item.paragraph_count,
        )
        if not (
            metrics.overflow_ratio > 0
            or metrics.bottom_gap_pt <= 2.0
            or metrics.right_gap_pt <= 2.0
        ):
            continue

        preview = load_preview(text_item.slide_number)
        if preview is None:
            issues.append(
                QualityIssue(
                    severity="not_checked",
                    issue_type="boundary_touch_ink_preview_missing",
                    message="该文本对象需要做边界触墨检查，但当前缺少对应 slide 预览图。",
                    slide_number=text_item.slide_number,
                    shape_id=text_item.owner_shape_id,
                    source_kind=text_item.source_kind,
                    details={"text": text_item.text},
                    suggested_fix="先导出逐页预览图，再运行 render review。",
                )
            )
            continue

        scale_x = preview.size[0] / slide_width_pt
        scale_y = preview.size[1] / slide_height_pt

        left, top, right, bottom = rect_pt_to_px(text_item.inner_rect_pt, scale_x, scale_y, preview.size)
        text_right_px = max(left, min(right, round(metrics.estimated_bounds_pt.right * scale_x)))
        text_bottom_px = max(top, min(bottom, round(metrics.estimated_bounds_pt.bottom * scale_y)))

        if (metrics.overflow_ratio > 0 or metrics.bottom_gap_pt <= 2.0) and text_bottom_px > top and right > left:
            bottom_crop = preview.crop((left, max(top, bottom - STRIP_PX), right, bottom))
            bottom_result = analyze_strip(bottom_crop)
            if should_flag_strip(bottom_result):
                issues.append(
                    QualityIssue(
                        severity="warning" if metrics.bottom_gap_pt <= 2.0 else "error",
                        issue_type="boundary_touch_ink_bottom",
                        message="文本框底边 strip 检测到明显深色笔画触边，存在字形下沿被切掉或贴边的风险。",
                        slide_number=text_item.slide_number,
                        shape_id=text_item.owner_shape_id,
                        source_kind=text_item.source_kind,
                        details={
                            "text": text_item.text,
                            "bottom_gap_pt": metrics.bottom_gap_pt,
                            "overflow_ratio": metrics.overflow_ratio,
                            "strip_analysis": bottom_result,
                        },
                        suggested_fix="增加文本框底部留白、加高文本框，或降低该对象的文案密度。",
                    )
                )

        if (metrics.overflow_ratio > 0 or metrics.right_gap_pt <= 2.0) and text_right_px > left and text_bottom_px > top:
            right_crop = preview.crop((max(left, right - STRIP_PX), top, right, text_bottom_px))
            right_result = analyze_strip(right_crop)
            if should_flag_strip(right_result):
                issues.append(
                    QualityIssue(
                        severity="warning" if metrics.right_gap_pt <= 2.0 else "error",
                        issue_type="boundary_touch_ink_right",
                        message="文本框右边 strip 检测到明显深色笔画触边，存在右侧笔画被切掉或贴边的风险。",
                        slide_number=text_item.slide_number,
                        shape_id=text_item.owner_shape_id,
                        source_kind=text_item.source_kind,
                        details={
                            "text": text_item.text,
                            "right_gap_pt": metrics.right_gap_pt,
                            "overflow_ratio": metrics.overflow_ratio,
                            "strip_analysis": right_result,
                        },
                        suggested_fix="增加文本框宽度、减少该行文案，或调整对象边界避免右侧触墨。",
                    )
                )

    for shape_record in shape_inventory:
        if shape_record.is_picture and shape_record.rect_pt.width >= 80 and shape_record.rect_pt.height >= 60:
            issues.append(
                QualityIssue(
                    severity="not_checked",
                    issue_type="flattened_graphic_internal_text_requires_review",
                    message="该图片对象可能含内部标题、刻度、标签或注释，结构预检无法看到图片内部文字，需要在 render review 或后续 OCR 终检中处理。",
                    slide_number=shape_record.slide_number,
                    shape_id=shape_record.shape_id,
                    source_kind="picture",
                    details={
                        "shape_name": shape_record.shape_name,
                        "shape_type": shape_record.shape_type,
                        "rect_pt": asdict(shape_record.rect_pt),
                    },
                    suggested_fix="保留逐页预览复核；如果该图片内部文字密集，后续应补 OCR / render-level overlap 检查。",
                )
            )

    payload = write_issue_bundle(
        title="PPTX Render Review Report",
        pptx_path=pptx_path,
        issues=issues,
        json_out=json_out,
        md_out=md_out,
        generated_at=generated_at,
        extra_payload={
            "preview_dir": str(preview_dir),
            "counts": {
                "shape_count": len(shape_inventory),
                "text_item_count": len(text_items),
            },
        },
    )

    print(f"[INFO] pptx={pptx_path}")
    print(f"[INFO] preview_dir={preview_dir}")
    print("[INFO] counts=" + json.dumps(payload["counts"], ensure_ascii=False))
    print(f"[INFO] summary={payload['summary']}")
    if json_out:
        print(f"[INFO] 写入 JSON: {json_out}")
    if md_out:
        print(f"[INFO] 写入 Markdown: {md_out}")

    if args.fail_on == "never":
        print("[OK] render review 完成（不按严重级别拦截）")
        return 0

    if args.fail_on == "warning" and (payload["summary"].get("warning", 0) > 0 or payload["summary"].get("error", 0) > 0):
        print("[FAIL] render review 检测到 warning 或 error")
        return 1

    if args.fail_on == "error" and payload["summary"].get("error", 0) > 0:
        print("[FAIL] render review 检测到 error")
        return 1

    print("[OK] render review 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
