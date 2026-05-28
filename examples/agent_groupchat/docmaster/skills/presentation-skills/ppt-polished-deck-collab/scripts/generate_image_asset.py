#!/usr/bin/env python3
"""为 `image-generation` asset slot 生成单张 GPT 图片资产。

定位与作用
----------
这个脚本是 `ppt-polished-deck-collab` 的最小 API backend：读取一个 prompt，
调用 GPT Image API，写出图片文件和同名元数据 JSON。它只处理“一个 slot 生成一个
图片 artifact”这件事，不负责决定页面叙事、不直接修改 PPT，也不替代生图后的
人工 visual review。

大致流程
--------
1. 从命令行、环境变量和可选 `.env` 文件读取 API 配置。
2. 调用 OpenAI 兼容 Images API，默认模型为 `gpt-image-2`。
3. 优先请求 `b64_json` 返回；如果中转站返回 URL，则下载 URL。
4. 写出图片和生成参数元数据，供 `asset_slot.output_files` 与 validation 引用。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import sys
import time
import urllib.request
from typing import Any


DEFAULT_MODEL = "gpt-image-2"
DEFAULT_SIZE = "auto"
DEFAULT_QUALITY = "medium"
DEFAULT_OUTPUT_FORMAT = "png"
DEFAULT_METADATA_SUFFIX = ".metadata.json"


def _die(message: str, code: int = 1) -> None:
    """输出错误并终止脚本。"""
    print(f"[ERROR] {message}", file=sys.stderr)
    raise SystemExit(code)


def _load_env_file(path: Path) -> dict[str, str]:
    """读取简单 `.env` 文件，不覆盖 shell 中已经显式设置的变量。"""
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def _find_default_env_file(start: Path) -> Path | None:
    """从当前目录向上查找最近的 `.env`。"""
    current = start.resolve()
    for path in (current, *current.parents):
        candidate = path / ".env"
        if candidate.exists():
            return candidate
    return None


def _read_prompt(prompt: str | None, prompt_file: Path | None) -> str:
    """从命令行文本或 prompt 文件读取最终提示词。"""
    if prompt and prompt_file:
        _die("只能使用 --prompt 或 --prompt-file 其中一个")
    if prompt_file:
        if not prompt_file.exists():
            _die(f"prompt 文件不存在: {prompt_file}")
        text = prompt_file.read_text(encoding="utf-8").strip()
    elif prompt:
        text = prompt.strip()
    else:
        _die("缺少 prompt，请使用 --prompt 或 --prompt-file")

    if not text:
        _die("prompt 为空")
    return text


def _resolve_api_config(args: argparse.Namespace) -> tuple[str, str | None, str]:
    """解析 API key、base URL 和配置来源。"""
    env_values: dict[str, str] = {}
    env_file_source = "not_loaded"
    if args.env_file:
        if not args.env_file.exists():
            _die(f".env 文件不存在: {args.env_file}")
        env_values = _load_env_file(args.env_file)
        env_file_source = str(args.env_file)
    elif args.load_env:
        found = _find_default_env_file(Path.cwd())
        if found:
            env_values = _load_env_file(found)
            env_file_source = str(found)

    def env_value(name: str) -> str | None:
        return os.getenv(name) or env_values.get(name)

    api_key = args.api_key or env_value("OPENAI_API_KEY") or env_value("OPENAINEXT_API_KEY")
    base_url = args.base_url or env_value("OPENAI_BASE_URL") or env_value("OPENAINEXT_API_BASE")

    if not api_key:
        _die("缺少 API key，请设置 OPENAI_API_KEY 或 OPENAINEXT_API_KEY")

    source = "shell_or_args"
    if not (args.api_key or os.getenv("OPENAI_API_KEY") or os.getenv("OPENAINEXT_API_KEY")):
        source = env_file_source
    return api_key, base_url, source


def _create_client(api_key: str, base_url: str | None) -> Any:
    """创建 OpenAI SDK client。"""
    try:
        from openai import OpenAI
    except ImportError:
        _die("当前 Python 环境缺少 openai 包，请先在目标环境安装 openai")

    kwargs: dict[str, Any] = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


def _response_item_to_bytes(item: Any) -> tuple[bytes, str]:
    """把 Images API 的单个返回项转成图片字节。"""
    b64_json = getattr(item, "b64_json", None)
    if b64_json:
        return base64.b64decode(b64_json), "b64_json"

    url = getattr(item, "url", None)
    if url:
        with urllib.request.urlopen(url) as response:  # noqa: S310
            return response.read(), "url"

    _die("图片响应没有 b64_json 或 url，无法落盘")
    raise AssertionError("unreachable")


def _write_metadata(
    path: Path,
    *,
    args: argparse.Namespace,
    prompt: str,
    output_path: Path,
    elapsed: float,
    response_source: str,
    api_source: str,
    base_url_set: bool,
    response_item: Any,
) -> None:
    """写出不含密钥和图片正文的生成元数据。"""
    item_meta: dict[str, Any] = {}
    if hasattr(response_item, "model_dump"):
        item_meta = response_item.model_dump(exclude={"b64_json", "url"})

    metadata = {
        "slot_id": args.slot_id,
        "page_role": args.page_role,
        "module": "image-generation",
        "backend": "gpt-image-api",
        "model": args.model,
        "size": args.size,
        "quality": args.quality,
        "output_format": args.output_format,
        "response_format": args.response_format,
        "response_source": response_source,
        "aspect_ratio": args.aspect_ratio,
        "crop_policy": args.crop_policy,
        "prompt": prompt,
        "output_file": str(output_path),
        "elapsed_seconds": round(elapsed, 3),
        "api_config_source": api_source,
        "base_url_set": base_url_set,
        "response_item": item_meta,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="生成单个 PPT image-generation asset slot 的图片资产")
    parser.add_argument("--prompt", help="直接传入 prompt 文本")
    parser.add_argument("--prompt-file", type=Path, help="从 Markdown 或文本文件读取 prompt")
    parser.add_argument("--out", type=Path, required=True, help="输出图片路径")
    parser.add_argument("--metadata-out", type=Path, help="输出生成元数据 JSON，默认与图片同名")
    parser.add_argument("--slot-id", help="可选：asset slot id，用于元数据登记")
    parser.add_argument("--page-role", help="可选：该图片在页面中的角色，例如 main_visual")
    parser.add_argument("--aspect-ratio", help="可选：slot 目标比例，例如 16:9 或 21:9")
    parser.add_argument("--crop-policy", help="可选：slot 裁切策略，例如 cover_center_safe_area")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"生图模型，默认 {DEFAULT_MODEL}")
    parser.add_argument("--size", default=DEFAULT_SIZE, help=f"图片尺寸，默认 {DEFAULT_SIZE}")
    parser.add_argument("--quality", default=DEFAULT_QUALITY, help=f"质量档位，默认 {DEFAULT_QUALITY}")
    parser.add_argument("--output-format", default=DEFAULT_OUTPUT_FORMAT, choices=["png", "jpeg", "webp"])
    parser.add_argument(
        "--response-format",
        default="b64_json",
        choices=["b64_json", "url"],
        help="Images API 返回格式，默认 b64_json，适配中转站保存逻辑",
    )
    parser.add_argument("--api-key", help="显式传入 API key；通常应使用环境变量")
    parser.add_argument("--base-url", help="显式传入 OpenAI 兼容 base URL")
    parser.add_argument("--env-file", type=Path, help="读取指定 .env 文件")
    parser.add_argument("--no-load-env", dest="load_env", action="store_false", help="不自动向上查找 .env")
    parser.add_argument("--force", action="store_true", help="允许覆盖已有输出")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要使用的非敏感参数，不调用 API")
    parser.set_defaults(load_env=True)
    return parser.parse_args()


def main() -> int:
    """执行单张图片生成。"""
    args = parse_args()
    prompt = _read_prompt(args.prompt, args.prompt_file)
    metadata_out = args.metadata_out or args.out.with_suffix(DEFAULT_METADATA_SUFFIX)

    if args.out.exists() and not args.force:
        _die(f"输出图片已存在: {args.out}，如需覆盖请加 --force")
    if metadata_out.exists() and not args.force:
        _die(f"元数据文件已存在: {metadata_out}，如需覆盖请加 --force")

    api_key, base_url, api_source = _resolve_api_config(args)

    payload = {
        "model": args.model,
        "prompt": prompt,
        "size": args.size,
        "quality": args.quality,
        "output_format": args.output_format,
        "response_format": args.response_format,
    }

    if args.dry_run:
        print(json.dumps({**payload, "out": str(args.out), "metadata_out": str(metadata_out), "base_url_set": bool(base_url)}, ensure_ascii=False, indent=2))
        return 0

    print("[INFO] 调用 Images API 生成图片")
    started = time.time()
    client = _create_client(api_key, base_url)
    result = client.images.generate(**payload)
    elapsed = time.time() - started

    if not getattr(result, "data", None):
        _die("Images API 返回为空")

    image_bytes, response_source = _response_item_to_bytes(result.data[0])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(image_bytes)
    _write_metadata(
        metadata_out,
        args=args,
        prompt=prompt,
        output_path=args.out,
        elapsed=elapsed,
        response_source=response_source,
        api_source=api_source,
        base_url_set=bool(base_url),
        response_item=result.data[0],
    )

    print(f"[OK] 写出图片: {args.out}")
    print(f"[OK] 写出元数据: {metadata_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
