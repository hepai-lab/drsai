#!/usr/bin/env python3
"""检查 PPTX 的文本边界、遮挡与结构化排版风险。

定位与作用
----------
这个脚本服务 `ppt-polished-deck-collab` 的 `structure_precheck` 质量 gate。
它关注的是 slide 结构层面是否已经出现明显排版风险，目的是在预览导出前就
提前拦住可以解释、可以定位、可以驱动修复的问题。

首期覆盖三类结果：
1. `textbox_fit_failure`
2. `text_occluded_by_shape`
3. `structured_chart_label_collision_not_checked`
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from pptx import Presentation

from ppt_quality_helpers import (
    QualityIssue,
    RectPt,
    collect_shape_inventory,
    collect_text_items,
    dump_json,
    estimate_text_layout_metrics,
    rect_intersection_area,
    resolve_gate_report_paths,
    shape_can_occlude,
    write_issue_bundle,
)

FULL_SLIDE_PICTURE_COVERAGE_THRESHOLD = 0.95


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="检查 PPTX 的文本边界与遮挡风险")
    parser.add_argument("--pptx", required=True, type=Path, help="输入 PPTX")
    parser.add_argument("--workspace-dir", type=Path, help="可选：按标准 validation 目录写入带时间戳报告")
    parser.add_argument("--json-out", type=Path, help="可选：写出 JSON 报告")
    parser.add_argument("--md-out", type=Path, help="可选：写出 Markdown 报告")
    parser.add_argument("--inventory-out", type=Path, help="可选：写出 shape inventory JSON")
    parser.add_argument(
        "--fail-on",
        choices=["error", "warning", "never"],
        default="error",
        help="达到哪个严重级别时返回非零 exit code",
    )
    parser.add_argument(
        "--full-slide-picture-severity",
        choices=["error", "warning", "not_checked"],
        default="error",
        help="整页图片对象的严重级别；默认 error，用于拦截把整页图片当背景的反模式",
    )
    return parser.parse_args()


def textbox_fit_issues(text_item) -> list[QualityIssue]:
    """检查单个文本对象的 fit 风险。"""
    metrics = estimate_text_layout_metrics(
        text_item.inner_rect_pt,
        text_item.text,
        text_item.font_size_pt,
        text_item.paragraph_count,
    )
    issues: list[QualityIssue] = []

    # 首期先压低弱层级短标签的噪声，避免 page id / pill 把报告淹没。
    if (
        text_item.font_size_pt <= 12.0
        and metrics.line_count_estimated == 1
        and text_item.paragraph_count == 1
        and len(text_item.text) <= 14
    ):
        return issues

    details = {
        "font_size_pt": text_item.font_size_pt,
        "line_count_estimated": metrics.line_count_estimated,
        "inner_rect_pt": asdict(text_item.inner_rect_pt),
        "estimated_text_bounds_pt": asdict(metrics.estimated_bounds_pt),
        "single_line_width_pt": metrics.single_line_width_pt,
        "effective_inner_width_pt": metrics.effective_inner_width_pt,
        "width_pressure_ratio": metrics.width_pressure_ratio,
        "max_line_width_pt": metrics.max_line_width_pt,
        "last_line_width_pt": metrics.last_line_width_pt,
        "bottom_gap_pt": metrics.bottom_gap_pt,
        "right_gap_pt": metrics.right_gap_pt,
        "overflow_area_pt2": metrics.overflow_area_pt2,
        "overflow_ratio": metrics.overflow_ratio,
        "text": text_item.text,
    }

    if metrics.overflow_ratio > 0 or metrics.bottom_gap_pt < 0 or metrics.right_gap_pt < 0:
        issues.append(
            QualityIssue(
                severity="error",
                issue_type="textbox_fit_failure",
                message="文本估计边界已经越出可用内容区，存在明确的文本框 fit 失败风险。",
                slide_number=text_item.slide_number,
                shape_id=text_item.owner_shape_id,
                source_kind=text_item.source_kind,
                details=details,
                suggested_fix="增加文本框高度、减少文案密度，或把内容拆到更多卡片 / 更多页。",
            )
        )
    elif (
        (metrics.bottom_gap_pt <= 2.0 or metrics.right_gap_pt <= 2.0)
        and (
            text_item.font_size_pt >= 14.0
            or metrics.line_count_estimated > 1
            or text_item.paragraph_count > 1
        )
    ):
        issues.append(
            QualityIssue(
                severity="warning",
                issue_type="textbox_fit_near_overflow",
                message="文本距离底边或右边过近，已经进入 near-overflow 区间。",
                slide_number=text_item.slide_number,
                shape_id=text_item.owner_shape_id,
                source_kind=text_item.source_kind,
                details=details,
                suggested_fix="优先增加容器高度或减少文字，不要默认继续压小字号。",
            )
        )
    return issues


def compact_width_pressure_issues(text_item) -> list[QualityIssue]:
    """检查短标签/短标题是否因为盒子过窄而被迫换行或强压边。"""
    if text_item.source_kind != "shape_text":
        return []
    if text_item.paragraph_count != 1:
        return []
    if "\n" in text_item.text:
        return []
    if len(text_item.text) > 18:
        return []

    metrics = estimate_text_layout_metrics(
        text_item.inner_rect_pt,
        text_item.text,
        text_item.font_size_pt,
        text_item.paragraph_count,
    )

    if metrics.width_pressure_ratio < 0.75:
        return []

    severity = "error" if metrics.width_pressure_ratio >= 0.9 else "warning"
    return [
        QualityIssue(
            severity=severity,
            issue_type="compact_textbox_width_pressure",
            message="短标题或标签的有效宽度过窄，已经进入 forced-wrap / width-pressure 区间，即使当前还没完全越界，也很容易出现被迫换行、压边或字形挤压。",
            slide_number=text_item.slide_number,
            shape_id=text_item.owner_shape_id,
            source_kind=text_item.source_kind,
            details={
                "text": text_item.text,
                "font_size_pt": text_item.font_size_pt,
                "single_line_width_pt": metrics.single_line_width_pt,
                "effective_inner_width_pt": metrics.effective_inner_width_pt,
                "width_pressure_ratio": metrics.width_pressure_ratio,
                "inner_rect_pt": asdict(text_item.inner_rect_pt),
            },
            suggested_fix="增加该标签框宽度，或缩短短标题文案，避免把本应单行的短文本塞进过窄容器。",
        )
    ]


def occlusion_issues(text_item, shape_records) -> list[QualityIssue]:
    """检查文字是否被更高 z-order 的对象遮挡。"""
    issues: list[QualityIssue] = []
    metrics = estimate_text_layout_metrics(
        text_item.inner_rect_pt,
        text_item.text,
        text_item.font_size_pt,
        text_item.paragraph_count,
    )
    text_bounds = metrics.estimated_bounds_pt
    text_area = max(1.0, text_bounds.width * text_bounds.height)

    for record in shape_records:
        if record.slide_number != text_item.slide_number:
            continue
        if record.shape_id == text_item.owner_shape_id:
            continue
        if record.z_order <= text_item.z_order:
            continue
        if not shape_can_occlude(record):
            continue

        overlap_area = rect_intersection_area(text_bounds, record.rect_pt)
        if overlap_area <= 0:
            continue
        overlap_ratio = round(overlap_area / text_area, 4)

        severity = None
        if overlap_ratio >= 0.08:
            severity = "error"
        elif overlap_ratio >= 0.03:
            severity = "warning"

        if severity is None:
            continue

        issues.append(
            QualityIssue(
                severity=severity,
                issue_type="text_occluded_by_shape",
                message="文本估计边界与更高层对象发生显著重叠，存在相邻对象压字风险。",
                slide_number=text_item.slide_number,
                shape_id=text_item.owner_shape_id,
                source_kind=text_item.source_kind,
                details={
                    "text": text_item.text,
                    "text_bounds_pt": asdict(text_bounds),
                    "occluding_shape_id": record.shape_id,
                    "occluding_shape_name": record.shape_name,
                    "occluding_shape_type": record.shape_type,
                    "occluding_rect_pt": asdict(record.rect_pt),
                    "overlap_area_pt2": overlap_area,
                    "overlap_ratio": overlap_ratio,
                },
                suggested_fix="移动遮挡对象、增加留白，或重排文本框与卡片边界。",
            )
        )
    return issues


def structured_object_overlap_issues(shape_inventory) -> list[QualityIssue]:
    """检查 table / chart / picture 等关键内容对象是否被更高层 shape 压住。"""
    issues: list[QualityIssue] = []
    targets = [
        record
        for record in shape_inventory
        if record.has_table or record.has_chart or record.is_picture
    ]

    for target in targets:
        target_area = max(1.0, target.rect_pt.width * target.rect_pt.height)
        for occluder in shape_inventory:
            if occluder.slide_number != target.slide_number:
                continue
            if occluder.shape_id == target.shape_id:
                continue
            if occluder.z_order <= target.z_order:
                continue
            if not shape_can_occlude(occluder):
                continue

            overlap_area = rect_intersection_area(target.rect_pt, occluder.rect_pt)
            if overlap_area <= 0:
                continue
            overlap_ratio = round(overlap_area / target_area, 4)

            severity = None
            if overlap_ratio >= 0.08:
                severity = "error"
            elif overlap_ratio >= 0.03:
                severity = "warning"

            if severity is None:
                continue

            issues.append(
                QualityIssue(
                    severity=severity,
                    issue_type="critical_content_occluded_by_shape",
                    message="关键内容对象的显示区域与更高层 shape 发生显著重叠，存在数据表、图表或图片被覆盖的风险。",
                    slide_number=target.slide_number,
                    shape_id=target.shape_id,
                    source_kind=target.source_kind,
                    details={
                        "target_shape_id": target.shape_id,
                        "target_shape_name": target.shape_name,
                        "target_shape_type": target.shape_type,
                        "target_rect_pt": asdict(target.rect_pt),
                        "occluding_shape_id": occluder.shape_id,
                        "occluding_shape_name": occluder.shape_name,
                        "occluding_shape_type": occluder.shape_type,
                        "occluding_rect_pt": asdict(occluder.rect_pt),
                        "overlap_area_pt2": overlap_area,
                        "overlap_ratio": overlap_ratio,
                    },
                    suggested_fix="调整 z-order 或几何位置，避免高层卡片、底板或装饰对象压住关键内容区域。",
                )
            )
    return issues


def slide_coverage_ratio(rect: RectPt, slide_rect: RectPt) -> float:
    """计算对象矩形覆盖 slide 可见区域的比例。"""
    slide_area = max(1.0, slide_rect.width * slide_rect.height)
    return round(rect_intersection_area(rect, slide_rect) / slide_area, 4)


def full_slide_picture_background_issues(
    shape_inventory,
    *,
    slide_width_pt: float,
    slide_height_pt: float,
    severity: str,
) -> list[QualityIssue]:
    """检查是否存在用整页图片冒充 PPT 原生背景的风险。"""
    issues: list[QualityIssue] = []
    slide_rect = RectPt(left=0.0, top=0.0, width=slide_width_pt, height=slide_height_pt)

    for record in shape_inventory:
        if not record.is_picture:
            continue

        coverage = slide_coverage_ratio(record.rect_pt, slide_rect)
        if coverage < FULL_SLIDE_PICTURE_COVERAGE_THRESHOLD:
            continue

        issues.append(
            QualityIssue(
                severity=severity,
                issue_type="full_slide_picture_background_risk",
                message="图片对象覆盖了几乎整个页面，存在把整页图片当作背景底板的反模式风险。",
                slide_number=record.slide_number,
                shape_id=record.shape_id,
                source_kind="picture",
                details={
                    "shape_name": record.shape_name,
                    "shape_type": record.shape_type,
                    "z_order": record.z_order,
                    "rect_pt": asdict(record.rect_pt),
                    "slide_rect_pt": asdict(slide_rect),
                    "coverage_ratio": coverage,
                    "threshold": FULL_SLIDE_PICTURE_COVERAGE_THRESHOLD,
                },
                suggested_fix=(
                    "如果它只是底色、纸纹、渐变、网格或装饰底板，应改用 slide.background.fill "
                    "或 PPT 原生矩形、线条、色块和 pattern 组合。只有真实照片、授权图、产品场景图 "
                    "或已在 slide_contract / asset_slot 中声明的 image-hero / image-generation 主视觉，"
                    "才应保留 full-bleed picture，并在 visual review 中说明。"
                ),
            )
        )

    return issues


def main() -> int:
    """执行 structure precheck。"""
    args = parse_args()
    pptx_path = args.pptx.resolve()
    if not pptx_path.exists():
        raise SystemExit(f"未找到 PPTX: {pptx_path}")
    json_out, md_out, generated_at = resolve_gate_report_paths(
        gate_name="structure_precheck",
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

    for text_item in text_items:
        issues.extend(textbox_fit_issues(text_item))
        issues.extend(compact_width_pressure_issues(text_item))
        issues.extend(occlusion_issues(text_item, shape_inventory))

    issues.extend(structured_object_overlap_issues(shape_inventory))
    issues.extend(
        full_slide_picture_background_issues(
            shape_inventory,
            slide_width_pt=slide_width_pt,
            slide_height_pt=slide_height_pt,
            severity=args.full_slide_picture_severity,
        )
    )

    slide_rect = RectPt(left=0.0, top=0.0, width=slide_width_pt, height=slide_height_pt)

    for shape_record in shape_inventory:
        if shape_record.has_chart:
            issues.append(
                QualityIssue(
                    severity="not_checked",
                    issue_type="structured_chart_label_collision_not_checked",
                    message="首期 `structure_precheck` 还没有读取原生 chart 内部 label 的真实边界，因此该 chart 的内部标签碰撞未自动检查。",
                    slide_number=shape_record.slide_number,
                    shape_id=shape_record.shape_id,
                    source_kind="chart",
                    details={
                        "shape_name": shape_record.shape_name,
                        "shape_type": shape_record.shape_type,
                        "rect_pt": asdict(shape_record.rect_pt),
                    },
                    suggested_fix="当前先保留逐页预览复核；后续可补 chart title / axis / legend / data label 的结构化检查。",
                )
            )
        if (
            shape_record.is_picture
            and shape_record.rect_pt.width >= 80
            and shape_record.rect_pt.height >= 60
            and slide_coverage_ratio(shape_record.rect_pt, slide_rect) < FULL_SLIDE_PICTURE_COVERAGE_THRESHOLD
        ):
            issues.append(
                QualityIssue(
                    severity="not_checked",
                    issue_type="flattened_graphic_requires_render_review",
                    message="该图片对象可能承载内部文字或图表标签，但结构预检无法看到图片内部对象边界，需要交给 render review。",
                    slide_number=shape_record.slide_number,
                    shape_id=shape_record.shape_id,
                    source_kind="picture",
                    details={
                        "shape_name": shape_record.shape_name,
                        "shape_type": shape_record.shape_type,
                        "rect_pt": asdict(shape_record.rect_pt),
                    },
                    suggested_fix="若该图片内部含文字、刻度或标签，请在预览导出后执行 render review，而不是把 `not_checked` 当成通过。",
                )
            )

    payload = write_issue_bundle(
        title="PPTX Structure Precheck Report",
        pptx_path=pptx_path,
        issues=issues,
        json_out=json_out,
        md_out=md_out,
        generated_at=generated_at,
        extra_payload={
            "counts": {
                "shape_count": len(shape_inventory),
                "text_item_count": len(text_items),
            }
        },
    )

    if args.inventory_out:
        args.inventory_out.parent.mkdir(parents=True, exist_ok=True)
        dump_json(
            args.inventory_out,
            {
                "pptx": str(pptx_path.resolve()),
                "shape_inventory": [asdict(record) for record in shape_inventory],
                "text_items": [asdict(item) for item in text_items],
            },
        )
        print(f"[INFO] 写入 inventory: {args.inventory_out}")

    print(f"[INFO] pptx={pptx_path}")
    print("[INFO] counts=" + json.dumps(payload["counts"], ensure_ascii=False))
    print(f"[INFO] summary={payload['summary']}")
    if json_out:
        print(f"[INFO] 写入 JSON: {json_out}")
    if md_out:
        print(f"[INFO] 写入 Markdown: {md_out}")

    if args.fail_on == "never":
        print("[OK] structure precheck 完成（不按严重级别拦截）")
        return 0

    if args.fail_on == "warning" and (payload["summary"].get("warning", 0) > 0 or payload["summary"].get("error", 0) > 0):
        print("[FAIL] structure precheck 检测到 warning 或 error")
        return 1

    if args.fail_on == "error" and payload["summary"].get("error", 0) > 0:
        print("[FAIL] structure precheck 检测到 error")
        return 1

    print("[OK] structure precheck 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
