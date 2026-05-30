#!/usr/bin/env python3
"""检查 deck workspace 的关键目录、核心输入与轻量合同是否齐全。

定位与作用
----------
这个脚本不判断页面美不美，而是判断 workspace 是否具备继续工作的最低条件。
它默认检查新的精简 workspace：`brief.md + deck_narrative.md + data/assets/build/validation/final`。
如果检测到旧的 `brief/ plan/ content/` 结构，会给出迁移 warning，但不会静默把旧结构当成新默认。

开启 `--check-contract` 后，脚本会轻量检查 `build/generated/slide_specs.yaml`：
deck mapping、slide 必填字段、枚举值、asset slot 字段、module/backend/status/validation 的一致性。
它不是重型 schema validator，目标是提前暴露会让 build 或验证链路漂移的明显问题。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml


REQUIRED_DIRS = ("data", "assets", "build", "validation", "final")
REQUIRED_FILES = ("brief.md", "deck_narrative.md")
LEGACY_HINT_DIRS = ("brief", "plan", "content")

ASSET_DIRS = (
    "diagrams",
    "charts",
    "icons",
    "images",
    "tables",
)

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

ALLOWED_PAGE_TASKS = {"persuade", "explain", "compare", "evidence", "archive"}
ALLOWED_READING_MODES = {"scan", "decision", "guided", "reference"}
ALLOWED_ASSET_MODES = {
    "text-layout-native",
    "diagram-connector",
    "diagram-visual",
    "office-chart-native",
    "python-figure-image",
    "table-native",
    "image-generation",
    "image-hero",
    "icon-accent",
    "mixed",
}
ALLOWED_VALIDATION_MODES = {
    "preview_only",
    "diagram_connector",
    "diagram_visual",
    "chart_editable",
    "chart_image",
    "table_native",
    "image_generated",
    "template_locked",
}
ALLOWED_SLOT_STATUSES = {
    "planned",
    "ready",
    "generated",
    "pending_user_generation",
    "inserted",
    "validated",
    "blocked",
}
MODULE_VALIDATION_MODES = {
    "text-layout-native": {"preview_only"},
    "diagram-connector": {"diagram_connector"},
    "diagram-visual": {"diagram_visual", "preview_only"},
    "office-chart-native": {"chart_editable"},
    "python-figure-image": {"chart_image"},
    "table-native": {"table_native", "preview_only"},
    "image-generation": {"image_generated"},
    "image-hero": {"preview_only", "image_generated"},
    "icon-accent": {"preview_only"},
}
MODULE_BACKENDS = {
    "text-layout-native": {"python-pptx"},
    "diagram-connector": {"python-pptx"},
    "diagram-visual": {"python-pptx", "mermaid", "manual"},
    "office-chart-native": {"python-pptx"},
    "python-figure-image": {"matplotlib", "seaborn", "python"},
    "table-native": {"python-pptx"},
    "image-generation": {"gpt-image-api", "manual-web", "external-image"},
    "image-hero": {"python-pptx", "external-image"},
    "icon-accent": {"icon-registry", "pymupdf"},
}
PROFILE_FIELDS = {
    "source_context": {"template_locked", "template_guided", "content_migration", "brand_assets_only", "no_template"},
    "delivery_context": {
        "self-contained_reading_deck",
        "speaker-led_stage_deck",
        "hybrid_review_deck",
        "reference_or_appendix_deck",
    },
    "communication_profile": {"business_report", "technical_explainer", "research_review", "keynote_story"},
    "visual_profile": {"corporate_clear", "editorial_ink", "swiss_modernist", "product_launch"},
    "density_profile": {"dense_reference", "balanced_brief", "low_density_stage"},
    "editability_profile": {"fully_editable", "chart_editable", "mixed_assets", "snapshot_allowed"},
}


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="检查 deck workspace 的关键目录、输入与轻量合同")
    parser.add_argument("--workspace-dir", required=True, type=Path, help="deck workspace 路径")
    parser.add_argument("--json-out", type=Path, help="可选：写出 lint 结果 JSON")
    parser.add_argument("--check-contract", action="store_true", help="检查 build/generated/slide_specs.yaml 的轻量合同")
    return parser.parse_args()


def _as_list(value: object) -> list:
    """把 YAML 字段规整成 list，用于轻量校验。"""
    return value if isinstance(value, list) else []


def _append_enum_error(errors: list[str], label: str, value: object, allowed_values: set[str]) -> None:
    """检查枚举值是否合法。"""
    if value is None:
        return
    if not isinstance(value, str) or value not in allowed_values:
        allowed = ", ".join(sorted(allowed_values))
        errors.append(f"{label}: 非法值 {value!r}，允许值: {allowed}")


def lint_asset_slot(
    slot: object,
    *,
    slide_label: str,
    index: int,
    workspace_dir: Path,
    errors: list[str],
    warnings: list[str],
) -> None:
    """检查单个 asset_slot 的字段、状态和 module/backend/validation 搭配。"""
    if not isinstance(slot, dict):
        errors.append(f"{slide_label}.asset_slots[{index}]: 必须是 mapping")
        return

    slot_label = f"{slide_label}.asset_slots[{index}]"
    for field in ("slot_id", "asset_type", "module", "validation_mode", "status"):
        if field not in slot:
            errors.append(f"{slot_label}: 缺少字段 {field}")

    module = slot.get("module")
    backend = slot.get("backend")
    validation_mode = slot.get("validation_mode")
    status = slot.get("status")

    _append_enum_error(errors, f"{slot_label}.module", module, set(MODULE_VALIDATION_MODES))
    _append_enum_error(errors, f"{slot_label}.status", status, ALLOWED_SLOT_STATUSES)
    _append_enum_error(errors, f"{slot_label}.validation_mode", validation_mode, ALLOWED_VALIDATION_MODES)

    if isinstance(module, str) and isinstance(validation_mode, str):
        allowed_validation = MODULE_VALIDATION_MODES.get(module, set())
        if validation_mode not in allowed_validation:
            allowed = ", ".join(sorted(allowed_validation))
            errors.append(f"{slot_label}: module={module} 与 validation_mode={validation_mode} 不匹配，应为: {allowed}")

    if isinstance(module, str) and backend is not None:
        allowed_backends = MODULE_BACKENDS.get(module, set())
        if not isinstance(backend, str) or backend not in allowed_backends:
            allowed = ", ".join(sorted(allowed_backends))
            errors.append(f"{slot_label}: module={module} 与 backend={backend!r} 不匹配，应为: {allowed}")

    input_files = _as_list(slot.get("input_files"))
    output_files = _as_list(slot.get("output_files"))
    for path_text in input_files:
        if isinstance(path_text, str) and not (workspace_dir / path_text).exists():
            warnings.append(f"{slot_label}: input_file 不存在: {path_text}")

    if status in {"generated", "inserted", "validated"} and not output_files:
        errors.append(f"{slot_label}: status={status} 时必须登记 output_files")

    if status == "validated" and "validation_evidence" not in slot:
        warnings.append(f"{slot_label}: status=validated 但缺少 validation_evidence")

    if module == "image-generation":
        if backend == "manual-web" and status == "planned":
            warnings.append(f"{slot_label}: manual-web 生图通常应进入 pending_user_generation，除非 prompt 还未写出")
        if backend == "manual-web" and status == "pending_user_generation" and not input_files:
            warnings.append(f"{slot_label}: pending_user_generation 应登记 prompt 文档 input_files")
        if backend == "gpt-image-api" and status == "pending_user_generation":
            warnings.append(f"{slot_label}: gpt-image-api 不应停在 pending_user_generation，应使用 planned/ready/generated/blocked 等状态")
        if backend == "gpt-image-api" and status in {"generated", "inserted", "validated"} and "validation_evidence" not in slot:
            warnings.append(f"{slot_label}: gpt-image-api 已生成图片时应登记 metadata JSON 到 validation_evidence")
        if status == "pending_user_generation" and output_files:
            warnings.append(f"{slot_label}: pending_user_generation 已有 output_files，建议更新为 generated 或 inserted")


def lint_slide_specs(workspace_dir: Path, errors: list[str], warnings: list[str]) -> dict:
    """检查派生 slide_specs.yaml 的轻量合同。"""
    specs_path = workspace_dir / "build" / "generated" / "slide_specs.yaml"
    result = {
        "path": str(specs_path),
        "exists": specs_path.exists(),
        "slides": 0,
        "asset_slots": 0,
    }
    if not specs_path.exists():
        warnings.append("跳过合同检查：缺少 build/generated/slide_specs.yaml")
        return result

    try:
        loaded = yaml.safe_load(specs_path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        errors.append(f"slide_specs.yaml YAML 解析失败: {exc}")
        return result

    if not isinstance(loaded, dict):
        errors.append("slide_specs.yaml 顶层必须是 mapping")
        return result

    deck = loaded.get("deck")
    if not isinstance(deck, dict):
        errors.append("slide_specs.yaml 缺少 deck mapping")
    else:
        for field, allowed in PROFILE_FIELDS.items():
            _append_enum_error(errors, f"deck.{field}", deck.get(field), allowed)
        theme_tokens = deck.get("theme_tokens")
        if theme_tokens is not None and not isinstance(theme_tokens, dict):
            errors.append("deck.theme_tokens 必须是 mapping")

    slides = loaded.get("slides")
    if not isinstance(slides, list):
        errors.append("slide_specs.yaml 缺少 slides list")
        return result

    result["slides"] = len(slides)
    seen_slide_ids: set[str] = set()
    for slide_index, slide in enumerate(slides, start=1):
        slide_label = f"slides[{slide_index}]"
        if not isinstance(slide, dict):
            errors.append(f"{slide_label}: 必须是 mapping")
            continue

        slide_id = slide.get("slide_id", f"#{slide_index}")
        if isinstance(slide_id, str):
            if slide_id in seen_slide_ids:
                errors.append(f"{slide_label}: slide_id 重复: {slide_id}")
            seen_slide_ids.add(slide_id)
            slide_label = f"{slide_id}"

        missing = [field for field in REQUIRED_SLIDE_FIELDS if field not in slide]
        if missing:
            errors.append(f"{slide_label}: 缺少字段 {', '.join(missing)}")

        _append_enum_error(errors, f"{slide_label}.page_task", slide.get("page_task"), ALLOWED_PAGE_TASKS)
        _append_enum_error(errors, f"{slide_label}.reading_mode", slide.get("reading_mode"), ALLOWED_READING_MODES)
        _append_enum_error(errors, f"{slide_label}.asset_mode", slide.get("asset_mode"), ALLOWED_ASSET_MODES)
        _append_enum_error(errors, f"{slide_label}.validation_mode", slide.get("validation_mode"), ALLOWED_VALIDATION_MODES)

        asset_slots = slide.get("asset_slots")
        if asset_slots is None:
            continue
        if not isinstance(asset_slots, list):
            errors.append(f"{slide_label}.asset_slots: 必须是 list")
            continue
        result["asset_slots"] += len(asset_slots)
        for slot_index, slot in enumerate(asset_slots):
            lint_asset_slot(
                slot,
                slide_label=slide_label,
                index=slot_index,
                workspace_dir=workspace_dir,
                errors=errors,
                warnings=warnings,
            )

    return result


def main() -> int:
    """执行 workspace lint。"""
    args = parse_args()
    workspace_dir = args.workspace_dir.resolve()

    if not workspace_dir.exists():
        raise SystemExit(f"workspace 不存在: {workspace_dir}")

    errors: list[str] = []
    warnings: list[str] = []

    required_dir_status: dict[str, bool] = {}
    for name in REQUIRED_DIRS:
        ok = (workspace_dir / name).is_dir()
        required_dir_status[name] = ok
        if not ok:
            errors.append(f"缺少目录: {name}/")

    required_file_status: dict[str, bool] = {}
    for name in REQUIRED_FILES:
        ok = (workspace_dir / name).is_file()
        required_file_status[name] = ok
        if not ok:
            errors.append(f"缺少文件: {name}")

    derived_specs_ok = (workspace_dir / "build" / "generated" / "slide_specs.yaml").exists()
    if not derived_specs_ok:
        warnings.append("缺少 build/generated/slide_specs.yaml，可由 derive_slide_specs_from_narrative.py 派生")

    legacy_dirs = [name for name in LEGACY_HINT_DIRS if (workspace_dir / name).exists()]
    if legacy_dirs:
        warnings.append("检测到 legacy 文档层: " + ", ".join(f"{name}/" for name in legacy_dirs))

    asset_counts: dict[str, int] = {}
    assets_dir = workspace_dir / "assets"
    for name in ASSET_DIRS:
        subdir = assets_dir / name
        if subdir.is_dir():
            asset_counts[name] = sum(1 for path in subdir.iterdir() if path.is_file())
        else:
            asset_counts[name] = 0
            warnings.append(f"缺少 assets/{name}/ 或该目录为空")

    contract_result = None
    if args.check_contract:
        contract_result = lint_slide_specs(workspace_dir, errors, warnings)

    result = {
        "workspace": str(workspace_dir),
        "required_dirs": required_dir_status,
        "required_files": required_file_status,
        "derived_slide_specs": derived_specs_ok,
        "contract_check": contract_result,
        "legacy_dirs": legacy_dirs,
        "asset_counts": asset_counts,
        "errors": errors,
        "warnings": warnings,
    }

    print(f"[INFO] workspace={workspace_dir}")
    print("[INFO] required_files=" + ", ".join(f"{k}:{v}" for k, v in required_file_status.items()))
    print(f"[INFO] derived_slide_specs={derived_specs_ok}")
    print("[INFO] asset_counts=" + ", ".join(f"{k}:{v}" for k, v in asset_counts.items()))
    if contract_result is not None:
        print(
            "[INFO] contract_check="
            + f"exists:{contract_result['exists']} slides:{contract_result['slides']} asset_slots:{contract_result['asset_slots']}"
        )

    for warning in warnings:
        print(f"[WARN] {warning}")
    for error in errors:
        print(f"[ERROR] {error}")

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[INFO] 写入 JSON: {args.json_out}")

    if errors:
        print(f"[FAIL] workspace lint 未通过，错误数: {len(errors)}")
        return 1

    print("[OK] workspace lint 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
