#!/usr/bin/env python3
"""管理 `ppt-polished-deck-collab` 的图标 registry、SVG 下载与 PNG 渲染。

定位与作用
----------
这个脚本把图标系统做成一个可执行的最小闭环：
1. 从 curated registry 下载 SVG
2. 用可验证的 backend 把 SVG 渲染成 PNG
3. 按关键字搜索适合 deck 排版的 icon

当前策略
--------
优先使用 Python 内的 `PyMuPDF` 渲染 SVG。
这条路线能正确尊重 `viewBox`，避免某些 macOS `qlmanage`
缩略图实现把图形错误地压到左上角的已知问题。
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.request import urlopen

SKILL_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = SKILL_ROOT / "assets" / "icons" / "tabler-outline" / "registry.json"
SVG_DIR = SKILL_ROOT / "assets" / "icons" / "tabler-outline" / "svg"
PNG_DIR = SKILL_ROOT / "assets" / "icons" / "tabler-outline" / "png"
DEFAULT_BACKGROUND_COLOR = "#F8FAFC"
DEFAULT_ACCENT_COLOR = "#2563EB"
DEFAULT_MUTED_LIGHT = "#475569"
DEFAULT_MUTED_DARK = "#E2E8F0"
DEFAULT_SEMANTIC_POSITIVE = "#059669"
DEFAULT_SEMANTIC_NEGATIVE = "#DC2626"


def _load_registry() -> dict:
    """读取 registry JSON。"""
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def _normalize_hex_color(value: str) -> str:
    """把颜色规范化为 `#RRGGBB`。"""
    cleaned = value.strip().lstrip("#")
    if len(cleaned) == 3:
        cleaned = "".join(ch * 2 for ch in cleaned)
    if len(cleaned) != 6:
        raise ValueError(f"非法颜色值: {value}")
    int(cleaned, 16)
    return f"#{cleaned.upper()}"


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    """把 `#RRGGBB` 转成 RGB 元组。"""
    normalized = _normalize_hex_color(value)
    return tuple(int(normalized[index : index + 2], 16) for index in (1, 3, 5))


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    """把 RGB 元组转成 `#RRGGBB`。"""
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def _mix_rgb(start: tuple[int, int, int], end: tuple[int, int, int], ratio: float) -> tuple[int, int, int]:
    """按比例混合两种 RGB 颜色。"""
    return tuple(round(start[index] * (1 - ratio) + end[index] * ratio) for index in range(3))


def _relative_luminance(rgb: tuple[int, int, int]) -> float:
    """计算 RGB 颜色的相对亮度。"""
    channels: list[float] = []
    for channel in rgb:
        srgb = channel / 255
        if srgb <= 0.04045:
            channels.append(srgb / 12.92)
        else:
            channels.append(((srgb + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def _contrast_ratio(foreground: tuple[int, int, int], background: tuple[int, int, int]) -> float:
    """计算前景色与背景色的对比度。"""
    fg = _relative_luminance(foreground)
    bg = _relative_luminance(background)
    lighter = max(fg, bg)
    darker = min(fg, bg)
    return (lighter + 0.05) / (darker + 0.05)


def _ensure_contrast(
    foreground: tuple[int, int, int],
    background: tuple[int, int, int],
    minimum_ratio: float = 3.0,
) -> tuple[int, int, int]:
    """把前景色向黑或白拉近，直到达到最低对比度。"""
    if _contrast_ratio(foreground, background) >= minimum_ratio:
        return foreground

    target = (0, 0, 0) if _relative_luminance(background) > 0.45 else (255, 255, 255)
    candidate = foreground
    for step in range(1, 25):
        candidate = _mix_rgb(foreground, target, step / 24)
        if _contrast_ratio(candidate, background) >= minimum_ratio:
            return candidate
    return candidate


def _semantic_base_color(item: dict) -> str:
    """根据语义角色推断语义色。"""
    haystack = " ".join(
        [
            item["id"],
            item["source_name"],
            *item.get("aliases", []),
            item.get("usage_note", ""),
        ]
    ).lower()

    negative_terms = ["risk", "warning", "alert", "issue", "danger", "problem", "风险", "告警", "问题"]
    positive_terms = ["safety", "security", "compliance", "check", "shield", "quality", "安全", "合规", "质量"]
    if any(term in haystack for term in positive_terms):
        return DEFAULT_SEMANTIC_POSITIVE
    if any(term in haystack for term in negative_terms):
        return DEFAULT_SEMANTIC_NEGATIVE
    return DEFAULT_ACCENT_COLOR


def _recommend_icon_color(item: dict, background_color: str, accent_color: str) -> tuple[str, str]:
    """基于背景色、accent 色和 registry role 推荐 icon 颜色。"""
    background_rgb = _hex_to_rgb(background_color)
    accent_rgb = _hex_to_rgb(accent_color)
    role = item.get("recommended_color_role", "muted")

    if role == "accent":
        base_rgb = accent_rgb
    elif role == "semantic":
        base_rgb = _hex_to_rgb(_semantic_base_color(item))
    else:
        base_rgb = _hex_to_rgb(DEFAULT_MUTED_LIGHT if _relative_luminance(background_rgb) > 0.45 else DEFAULT_MUTED_DARK)

    adjusted_rgb = _ensure_contrast(base_rgb, background_rgb, minimum_ratio=3.2)
    return _rgb_to_hex(adjusted_rgb), role


def _colorize_svg(svg_path: Path, icon_color: str | None) -> bytes:
    """读取 SVG，并在需要时把 `currentColor` 替换成目标颜色。"""
    svg_text = svg_path.read_text(encoding="utf-8")
    if not icon_color:
        return svg_text.encode("utf-8")

    normalized = _normalize_hex_color(icon_color)
    colored = svg_text.replace("currentColor", normalized)
    if "<svg" in colored:
        colored = colored.replace("<svg", f'<svg color="{normalized}"', 1)
    return colored.encode("utf-8")


def _resolve_output_dir(size: int, color_mode: str, theme_name: str, out_dir: Path | None) -> Path:
    """根据渲染模式确定输出目录。"""
    if out_dir is not None:
        return out_dir.resolve()
    base_dir = PNG_DIR / str(size)
    if color_mode == "original" and theme_name == "default":
        return base_dir
    return base_dir / theme_name


def _render_svg_to_png_with_fitz(svg_bytes: bytes, png_path: Path, size: int) -> None:
    """使用 PyMuPDF 把 SVG 渲染成透明背景 PNG。"""
    try:
        import fitz
    except ModuleNotFoundError as exc:
        raise RuntimeError("当前环境未安装 PyMuPDF，无法使用 fitz backend") from exc

    doc = fitz.open(stream=svg_bytes, filetype="svg")
    if doc.page_count != 1:
        raise RuntimeError("SVG 页数异常，无法渲染")

    page = doc[0]
    rect = page.rect
    if rect.width <= 0 or rect.height <= 0:
        raise RuntimeError("SVG 尺寸异常，无法渲染")

    scale = size / max(rect.width, rect.height)
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=True)
    pix.save(png_path)


def _render_svg_to_png_with_qlmanage(svg_bytes: bytes, png_path: Path, size: int) -> None:
    """使用 macOS `qlmanage` 缩略图功能渲染 PNG。"""
    png_path.parent.mkdir(parents=True, exist_ok=True)

    qlmanage = shutil.which("qlmanage")
    if not qlmanage:
        raise RuntimeError("当前环境未找到 qlmanage，无法使用 qlmanage backend")

    temp_svg_path: Path | None = None
    temp_out = png_path.parent / "_qlmanage_out"
    temp_out.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".svg") as handle:
        handle.write(svg_bytes)
        temp_svg_path = Path(handle.name)

    try:
        subprocess.run(
            [qlmanage, "-t", "-s", str(size), "-o", str(temp_out), str(temp_svg_path)],
            check=True,
            capture_output=True,
            text=True,
        )

        generated = temp_out / f"{temp_svg_path.name}.png"
        if not generated.exists():
            raise RuntimeError("qlmanage 未生成 PNG")
        if png_path.exists():
            png_path.unlink()
        generated.rename(png_path)
    finally:
        if temp_svg_path is not None and temp_svg_path.exists():
            temp_svg_path.unlink()
        shutil.rmtree(temp_out, ignore_errors=True)


def _render_svg_to_png(svg_path: Path, png_path: Path, size: int, backend: str, icon_color: str | None) -> str:
    """把 SVG 渲染成 PNG，并返回实际使用的 backend。"""
    png_path.parent.mkdir(parents=True, exist_ok=True)
    svg_bytes = _colorize_svg(svg_path, icon_color)

    if backend == "fitz":
        _render_svg_to_png_with_fitz(svg_bytes, png_path, size)
        return "fitz"
    if backend == "qlmanage":
        _render_svg_to_png_with_qlmanage(svg_bytes, png_path, size)
        return "qlmanage"
    if backend == "auto":
        try:
            _render_svg_to_png_with_fitz(svg_bytes, png_path, size)
            return "fitz"
        except Exception:
            _render_svg_to_png_with_qlmanage(svg_bytes, png_path, size)
            return "qlmanage"
    raise ValueError(f"未知 backend: {backend}")


def _selected_icons(registry: dict, pack: str | None) -> list[dict]:
    """按 pack 过滤 icon 列表。"""
    if not pack:
        return registry["icons"]
    return [item for item in registry["icons"] if pack in item.get("packs", [])]


def cmd_search(query: str, pack: str | None) -> int:
    """按关键字搜索 icon。"""
    registry = _load_registry()
    terms = [term.strip().lower() for term in query.split() if term.strip()]
    matches: list[tuple[int, dict]] = []

    for item in _selected_icons(registry, pack):
        haystack = " ".join([item["id"], item["source_name"], *item["aliases"], item["usage_note"]]).lower()
        score = sum(term in haystack for term in terms)
        if score > 0:
            matches.append((score, item))

    matches.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
    for score, item in matches[:10]:
        packs = ",".join(item.get("packs", []))
        print(f"[MATCH] score={score} id={item['id']} source={item['source_name']} packs={packs}")
        print(f"        aliases={','.join(item['aliases'][:4])}")
        print(f"        usage={item['usage_note']}")
    if not matches:
        print("[INFO] 未找到匹配 icon")
    return 0


def cmd_sync(pack: str | None) -> int:
    """下载 registry 里定义的 SVG。"""
    registry = _load_registry()
    family = registry["family"]
    SVG_DIR.mkdir(parents=True, exist_ok=True)

    selected = _selected_icons(registry, pack)
    for item in selected:
        url = family["source_url_template"].format(icon=item["source_name"])
        out_path = SVG_DIR / f"{item['source_name']}.svg"
        with urlopen(url) as response:  # noqa: S310
            data = response.read()
        out_path.write_bytes(data)
        print(f"[OK] 下载 {item['source_name']} -> {out_path}")

    print(f"[OK] 已同步 {len(selected)} 个 SVG")
    return 0


def cmd_render(
    size: int,
    pack: str | None,
    backend: str,
    color_mode: str,
    icon_color: str | None,
    background_color: str,
    accent_color: str,
    theme_name: str,
    out_dir: Path | None,
) -> int:
    """把 SVG 渲染成指定尺寸 PNG。"""
    registry = _load_registry()
    out_dir = _resolve_output_dir(size, color_mode, theme_name, out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    selected = _selected_icons(registry, pack)
    used_backends: set[str] = set()
    for item in selected:
        svg_path = SVG_DIR / f"{item['source_name']}.svg"
        if not svg_path.exists():
            raise FileNotFoundError(f"缺少 SVG，请先执行 sync: {svg_path}")
        png_path = out_dir / f"{item['source_name']}.png"
        chosen_color = None
        color_role = "original"
        if color_mode == "fixed":
            if not icon_color:
                raise ValueError("color_mode=fixed 时必须提供 --icon-color")
            chosen_color = _normalize_hex_color(icon_color)
            color_role = "fixed"
        elif color_mode == "auto":
            chosen_color, color_role = _recommend_icon_color(item, background_color, accent_color)

        used_backend = _render_svg_to_png(svg_path, png_path, size=size, backend=backend, icon_color=chosen_color)
        used_backends.add(used_backend)
        print(
            f"[OK] 渲染 {svg_path.name} -> {png_path} "
            f"backend={used_backend} color_mode={color_mode} role={color_role} color={chosen_color or 'original'}"
        )

    print(
        f"[OK] 已渲染 {len(selected)} 个 PNG, size={size}, out_dir={out_dir}, "
        f"backends={','.join(sorted(used_backends))}"
    )
    return 0


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="管理 polished deck skill 的图标 registry")
    subparsers = parser.add_subparsers(dest="command", required=True)

    search_parser = subparsers.add_parser("search", help="按关键字搜索 icon")
    search_parser.add_argument("--query", required=True, help="搜索词，例如 'risk safety'")
    search_parser.add_argument("--pack", help="可选：只在某个 pack 内搜索，例如 llm-research")

    sync_parser = subparsers.add_parser("sync", help="从官方源下载 curated SVG")
    sync_parser.add_argument("--pack", help="可选：只同步某个 pack")

    render_parser = subparsers.add_parser("render", help="把 SVG 渲染成 PNG")
    render_parser.add_argument("--size", type=int, default=128, help="PNG 边长，默认 128")
    render_parser.add_argument("--pack", help="可选：只渲染某个 pack")
    render_parser.add_argument(
        "--backend",
        default="auto",
        choices=["auto", "fitz", "qlmanage"],
        help="SVG 渲染 backend，默认 auto，优先 fitz",
    )
    render_parser.add_argument(
        "--color-mode",
        default="original",
        choices=["original", "auto", "fixed"],
        help="颜色模式：original 保持原 SVG 颜色，auto 按背景和 role 推断，fixed 使用固定颜色",
    )
    render_parser.add_argument("--icon-color", help="固定颜色模式下使用的图标颜色，例如 #2563EB")
    render_parser.add_argument(
        "--background-color",
        default=DEFAULT_BACKGROUND_COLOR,
        help=f"slide 背景色，默认 {DEFAULT_BACKGROUND_COLOR}",
    )
    render_parser.add_argument(
        "--accent-color",
        default=DEFAULT_ACCENT_COLOR,
        help=f"主题 accent 色，默认 {DEFAULT_ACCENT_COLOR}",
    )
    render_parser.add_argument(
        "--theme-name",
        default="default",
        help="主题变体名称；当颜色模式不是 original 时，会用于生成子目录",
    )
    render_parser.add_argument("--out-dir", type=Path, help="可选：显式指定输出目录")

    subparsers.add_parser("list-packs", help="列出所有可用 pack")

    return parser.parse_args()


def main() -> int:
    """CLI 入口。"""
    args = parse_args()
    if args.command == "search":
        return cmd_search(args.query, args.pack)
    if args.command == "sync":
        return cmd_sync(args.pack)
    if args.command == "render":
        return cmd_render(
            args.size,
            args.pack,
            args.backend,
            args.color_mode,
            args.icon_color,
            args.background_color,
            args.accent_color,
            args.theme_name,
            args.out_dir,
        )
    if args.command == "list-packs":
        registry = _load_registry()
        for pack in registry.get("packs", []):
            print(f"[PACK] {pack['id']}: {pack['label']}")
            print(f"       {pack['description']}")
        return 0
    raise SystemExit(f"未知命令: {args.command}")


if __name__ == "__main__":
    sys.exit(main())
