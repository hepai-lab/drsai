#!/usr/bin/env python3
"""检查 PPTX 包结构一致性与移动端兼容风险。

定位与作用
----------
这个脚本服务 `ppt-polished-deck-collab` 的 `package_preflight` 质量 gate。
它关注的是 deck 文件本身能否被更脆弱的解析器稳定接受，而不是页面排版美不美。
首期重点覆盖：
1. zip 包完整性；
2. slide 数与包内元信息一致性；
3. section 引用与当前 slide 列表一致性；
4. 嵌入对象等已知移动端风险信号。
"""

from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

from pptx import Presentation

from ppt_quality_helpers import QualityIssue, write_issue_bundle
from ppt_quality_helpers import resolve_gate_report_paths

REL_NS = {"rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
P_NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main",
}

SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="检查 PPTX 包结构一致性与移动端兼容风险")
    parser.add_argument("--pptx", required=True, type=Path, help="输入 PPTX")
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


def _read_xml(archive: ZipFile, member_name: str) -> ET.Element:
    """读取 zip 内 XML。"""
    return ET.fromstring(archive.read(member_name))


def _presentation_slide_ids(root: ET.Element) -> list[str]:
    """读取 presentation.xml 中当前 slide id 列表。"""
    return [node.get("id", "") for node in root.findall(".//p:sldIdLst/p:sldId", P_NS)]


def _section_slide_ids(root: ET.Element) -> list[str]:
    """读取 sectionLst 中引用的 slide id 列表。"""
    return [node.get("id", "") for node in root.findall(".//p14:sectionLst/p14:section/p14:sldIdLst/p14:sldId", P_NS)]


def _slide_relationship_targets(root: ET.Element) -> list[str]:
    """读取 presentation.xml.rels 中的 slide 目标。"""
    targets: list[str] = []
    for relationship in root.findall("rel:Relationship", REL_NS):
        if relationship.get("Type") == SLIDE_REL_TYPE:
            targets.append(relationship.get("Target", ""))
    return targets


def _app_slide_count(text: str) -> int | None:
    """读取 docProps/app.xml 中的 Slides 值。"""
    match = re.search(r"<Slides>(\d+)</Slides>", text)
    return int(match.group(1)) if match else None


def _embedded_objects(archive: ZipFile) -> list[str]:
    """列出嵌入对象。"""
    return sorted(
        name
        for name in archive.namelist()
        if name.startswith("ppt/embeddings/") or "oleObject" in name
    )


def main() -> int:
    """执行 package preflight。"""
    args = parse_args()
    pptx_path = args.pptx.resolve()
    if not pptx_path.exists():
        raise SystemExit(f"未找到 PPTX: {pptx_path}")
    json_out, md_out, generated_at = resolve_gate_report_paths(
        gate_name="package_preflight",
        workspace_dir=args.workspace_dir,
        json_out=args.json_out,
        md_out=args.md_out,
    )

    issues: list[QualityIssue] = []

    with ZipFile(pptx_path) as archive:
        bad_member = archive.testzip()
        if bad_member is not None:
            issues.append(
                QualityIssue(
                    severity="error",
                    issue_type="zip_integrity_failure",
                    message=f"zip 包校验失败，首个损坏成员为 `{bad_member}`。",
                    details={"bad_member": bad_member},
                    suggested_fix="重新生成 PPTX，不要继续基于当前产物做预览或外发。",
                )
            )

        presentation_root = _read_xml(archive, "ppt/presentation.xml")
        rels_root = _read_xml(archive, "ppt/_rels/presentation.xml.rels")
        app_text = archive.read("docProps/app.xml").decode("utf-8", "ignore")

        slide_ids = _presentation_slide_ids(presentation_root)
        section_ids = _section_slide_ids(presentation_root)
        slide_targets = _slide_relationship_targets(rels_root)
        slide_xml_names = sorted(
            name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml")
        )
        embedded_objects = _embedded_objects(archive)

    actual_slide_count = len(Presentation(pptx_path).slides)
    app_slide_count = _app_slide_count(app_text)

    if len(slide_ids) != actual_slide_count:
        issues.append(
            QualityIssue(
                severity="error",
                issue_type="presentation_slide_count_mismatch",
                message="`presentation.xml` 中的 slide 列表数量与实际可打开的 slide 数不一致。",
                details={
                    "presentation_slide_count": len(slide_ids),
                    "actual_slide_count": actual_slide_count,
                },
                suggested_fix="不要只删 `_sldIdLst`。同时修正相关扩展信息与文档属性，再重新打包。",
            )
        )

    if app_slide_count is not None and app_slide_count != actual_slide_count:
        issues.append(
            QualityIssue(
                severity="error",
                issue_type="docprops_slide_count_mismatch",
                message="`docProps/app.xml` 中的 `Slides` 统计与实际 slide 数不一致，这对移动端解析器是高风险信号。",
                details={
                    "docprops_slide_count": app_slide_count,
                    "actual_slide_count": actual_slide_count,
                },
                suggested_fix="在最终打包前重写 `docProps/app.xml` 的 slide 统计，保证和真实 deck 一致。",
            )
        )

    stale_section_ids = sorted(set(section_ids) - set(slide_ids))
    if stale_section_ids:
        issues.append(
            QualityIssue(
                severity="error",
                issue_type="stale_section_reference",
                message="`presentation.xml` 里的 section 扩展仍引用了已不存在的旧 slide id。",
                details={
                    "stale_section_ids": stale_section_ids,
                    "current_slide_ids": slide_ids,
                },
                suggested_fix="在删页或重组 deck 后同步清理 `p14:sectionLst`，不要保留模板遗留的旧 slide id。",
            )
        )

    missing_slide_targets = sorted(target for target in slide_targets if f"ppt/{target}" not in slide_xml_names)
    if missing_slide_targets:
        issues.append(
            QualityIssue(
                severity="error",
                issue_type="missing_slide_relationship_target",
                message="`presentation.xml.rels` 中存在指向缺失 slide xml 的关系。",
                details={"missing_targets": missing_slide_targets},
                suggested_fix="重新生成 `presentation.xml.rels` 或重新保存 PPTX，保证 slide relationship 与实际文件一致。",
            )
        )

    if len(slide_targets) != actual_slide_count:
        issues.append(
            QualityIssue(
                severity="error",
                issue_type="slide_relationship_count_mismatch",
                message="slide relationship 数量与实际 slide 数不一致。",
                details={
                    "relationship_slide_count": len(slide_targets),
                    "actual_slide_count": actual_slide_count,
                },
                suggested_fix="检查 presentation rels 是否残留旧 slide 关系或丢失新 slide 关系。",
            )
        )

    if embedded_objects:
        issues.append(
            QualityIssue(
                severity="warning",
                issue_type="mobile_compatibility_embedded_object",
                message="deck 中存在嵌入对象，这类对象在微信预览与移动端 WPS 中兼容性更脆弱。",
                details={"embedded_objects": embedded_objects},
                suggested_fix="如果外发目标包含微信或移动端 WPS，优先改为图片化 chart 或移除 workbook embedding。",
            )
        )

    payload = write_issue_bundle(
        title="PPTX Package Preflight Report",
        pptx_path=pptx_path,
        issues=issues,
        json_out=json_out,
        md_out=md_out,
        generated_at=generated_at,
        extra_payload={
            "checks": {
                "actual_slide_count": actual_slide_count,
                "presentation_slide_count": len(slide_ids),
                "docprops_slide_count": app_slide_count,
                "section_slide_id_count": len(section_ids),
                "slide_relationship_count": len(slide_targets),
                "slide_xml_count": len(slide_xml_names),
                "embedded_object_count": len(embedded_objects),
            }
        },
    )

    print(f"[INFO] pptx={pptx_path}")
    print("[INFO] checks=" + json.dumps(payload["checks"], ensure_ascii=False))
    print(f"[INFO] summary={payload['summary']}")
    if json_out:
        print(f"[INFO] 写入 JSON: {json_out}")
    if md_out:
        print(f"[INFO] 写入 Markdown: {md_out}")

    if args.fail_on == "never":
        print("[OK] package preflight 完成（不按严重级别拦截）")
        return 0

    if args.fail_on == "warning" and (payload["summary"].get("warning", 0) > 0 or payload["summary"].get("error", 0) > 0):
        print("[FAIL] package preflight 检测到 warning 或 error")
        return 1

    if args.fail_on == "error" and payload["summary"].get("error", 0) > 0:
        print("[FAIL] package preflight 检测到 error")
        return 1

    print("[OK] package preflight 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
