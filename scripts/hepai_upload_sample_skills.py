#!/usr/bin/env python3
"""
Build ~10 minimal skill ZIPs (root SKILL.md) from repo anthropic_skills_collection
and POST them to DrSai HepAI upload API — same path as the Skills Square UI.

DEV 模式需要环境变量 HEPAI_API_KEY；user_id 须与前端登录邮箱一致，列表才会对上。

用法:
  export HEPAI_API_KEY=...   # 若本机为 DEV
  python3 scripts/hepai_upload_sample_skills.py \\
    --base-url http://127.0.0.1:8081 \\
    --user-id your@email.com

仅打包不上传:
  python3 scripts/hepai_upload_sample_skills.py --dry-run
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

# 仓库根（本脚本在 scripts/ 下）
REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "agent_skills" / "anthropic_skills_collection"

# 选 10 个 Anthropic 示例技能（仓库内已有 SKILL.md）
SAMPLE_SKILL_DIRS = [
    "frontend-design",
    "algorithmic-art",
    "internal-comms",
    "brand-guidelines",
    "theme-factory",
    "skill-creator",
    "mcp-builder",
    "claude-api",
    "doc-coauthoring",
    "canvas-design",
]


def build_zip(skill_dir: Path, out_zip: Path) -> None:
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        raise FileNotFoundError(f"Missing SKILL.md: {skill_md}")
    out_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(skill_md, "SKILL.md")


def upload_one(base_url: str, user_id: str, zip_path: Path) -> int:
    from urllib.parse import quote

    q = quote(user_id, safe="")
    url = f"{base_url.rstrip('/')}/api/files/hepai/upload?user_id={q}"
    cmd = ["curl", "-sS", "-w", "\n%{http_code}", "-X", "POST", "-F", f"file=@{zip_path}", url]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = (proc.stdout or "").strip()
    lines = out.split("\n")
    code = lines[-1] if lines else ""
    body = "\n".join(lines[:-1]) if len(lines) > 1 else out
    print(f"  HTTP {code}  {zip_path.name}")
    if body:
        print(f"  {body[:500]}{'…' if len(body) > 500 else ''}")
    if proc.returncode != 0:
        print(proc.stderr or "", file=sys.stderr)
    return proc.returncode


def main() -> int:
    ap = argparse.ArgumentParser(description="Upload sample HepAI skill ZIPs for UI testing.")
    ap.add_argument(
        "--base-url",
        default="http://127.0.0.1:8081",
        help="DrSai 后端根 URL（不含 /api 时下面会自动补）",
    )
    ap.add_argument(
        "--user-id",
        default="",
        help="与前端一致的 user_id（一般为登录邮箱）。不设则读环境变量 HEPAI_UPLOAD_USER_ID",
    )
    ap.add_argument("--dry-run", action="store_true", help="只打 ZIP 包，不调用接口")
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    if not base.endswith("/api"):
        # 允许传 http://host:8081 或 http://host:8081/api
        pass  # upload URL 已含 /api/files/...

    user_id = (args.user_id or "").strip() or os.environ.get("HEPAI_UPLOAD_USER_ID", "").strip()
    if not args.dry_run and not user_id:
        print("请设置 --user-id 或环境变量 HEPAI_UPLOAD_USER_ID（登录邮箱）", file=sys.stderr)
        return 2

    tmp = Path(tempfile.mkdtemp(prefix="hepai-sample-zips-"))
    try:
        zips: list[Path] = []
        for name in SAMPLE_SKILL_DIRS:
            src = SKILLS_ROOT / name
            zp = tmp / f"{name}-skill.zip"
            build_zip(src, zp)
            zips.append(zp)
            print(f"ZIP  {zp.name}  <-  {src / 'SKILL.md'}")

        if args.dry_run:
            print(f"\n--dry-run：共 {len(zips)} 个 ZIP（见下方目录）")
            return 0

        print(f"\n上传到 {base}/api/files/hepai/upload  user_id={user_id!r}\n")
        rc_all = 0
        for zp in zips:
            rc = upload_one(base, user_id, zp)
            if rc != 0:
                rc_all = rc
        return rc_all
    finally:
        if args.dry_run:
            print(f"\nZIP 目录（可手动检查）: {tmp}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
