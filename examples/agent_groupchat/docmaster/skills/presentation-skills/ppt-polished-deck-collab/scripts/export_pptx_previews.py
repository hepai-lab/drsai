#!/usr/bin/env python3
"""把 PPTX 导出成逐页 PNG 预览图。

定位与作用
----------
这个脚本服务于新 skill 的逐页预览导出步骤。它显式支持多条路线：
1. PowerPoint -> PDF -> PNG
2. LibreOffice -> PDF -> PNG

PDF 到 PNG 的最后一步也支持 `pdftoppm` 与 `PyMuPDF` 两种实现。
脚本会显式输出所选 backend，避免静默切换技术路线。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
import time
from contextlib import contextmanager
import fcntl
from pathlib import Path

from pptx import Presentation

try:
    import fitz
except Exception:  # noqa: BLE001
    fitz = None


POWERPOINT_APP = Path("/Applications/Microsoft PowerPoint.app")
OFFICE_TEMP_DIR = Path.home() / "Library/Group Containers/UBF8T346G9.Office/TemporaryItems"
POWERPOINT_LOCK = Path(tempfile.gettempdir()) / "ppt_polished_powerpoint_export.lock"


def _to_hfs_path(path: Path) -> str:
    """把绝对路径转成 AppleScript 可用的 HFS 路径。"""
    resolved = path.resolve()
    parts = resolved.parts
    if not parts or parts[0] != "/":
        raise ValueError(f"路径必须是绝对路径: {path}")
    return "Macintosh HD:" + ":".join(parts[1:])


def _wait_for_file(path: Path, timeout_s: float = 20.0) -> None:
    """等待文件真正落盘。"""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if path.exists() and path.stat().st_size > 0:
            return
        time.sleep(0.5)
    raise TimeoutError(f"等待文件落盘超时: {path}")


@contextmanager
def _powerpoint_export_lock(timeout_s: float = 60.0):
    """对 PowerPoint 导出链路加串行锁，避免 GUI 会话并发冲突。"""
    POWERPOINT_LOCK.parent.mkdir(parents=True, exist_ok=True)
    with POWERPOINT_LOCK.open("w", encoding="utf-8") as lock_file:
        lock_file.write(str(os.getpid()))
        lock_file.flush()

        deadline = time.time() + timeout_s
        while True:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.time() >= deadline:
                    raise TimeoutError("等待 PowerPoint 导出锁超时，请确认没有其他进程正在导出预览图")
                time.sleep(0.5)

        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _select_pdf_backend(backend: str) -> str:
    """选择 PDF 导出 backend。"""
    if backend != "auto":
        return backend

    if POWERPOINT_APP.exists() and OFFICE_TEMP_DIR.exists():
        return "powerpoint"
    if shutil.which("libreoffice") or shutil.which("soffice"):
        return "libreoffice"
    raise RuntimeError("当前环境既没有可用的 PowerPoint 路线，也没有可用的 LibreOffice 路线")


def _select_render_backend(backend: str) -> str:
    """选择 PDF 渲染 backend。"""
    if backend != "auto":
        return backend
    if shutil.which("pdftoppm"):
        return "pdftoppm"
    if fitz is not None:
        return "fitz"
    raise RuntimeError("当前环境既没有 pdftoppm，也没有可用的 PyMuPDF")


def _export_pdf_via_powerpoint(pptx_path: Path, pdf_path: Path) -> None:
    """使用 PowerPoint AppleScript 导出 PDF。"""
    if not POWERPOINT_APP.exists():
        raise FileNotFoundError(f"未找到 PowerPoint: {POWERPOINT_APP}")
    if not OFFICE_TEMP_DIR.exists():
        raise FileNotFoundError(f"未找到 Office 临时目录: {OFFICE_TEMP_DIR}")

    script = f"""
set outputPathHFS to "{_to_hfs_path(pdf_path)}"
tell application "Microsoft PowerPoint"
  activate
  try
    repeat with pres in presentations
      close pres saving no
    end repeat
    open POSIX file "{pptx_path.resolve()}"
    delay 2
    save active presentation in outputPathHFS as save as PDF
    delay 1
    close active presentation saving no
    return "OK"
  on error errMsg number errNum
    try
      close active presentation saving no
    end try
    return "ERR|" & errNum & "|" & errMsg
  end try
end tell
"""
    completed = subprocess.run(
        ["osascript", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    result = completed.stdout.strip()
    if result.startswith("ERR|"):
        parts = result.split("|", 2)
        err_num = parts[1] if len(parts) > 1 else ""
        hint = ""
        if err_num in {"-1743", "-10004"}:
            hint = (
                " 可能是 macOS Automation 权限未授予，请检查 System Settings -> Privacy & Security -> Automation，"
                "确认当前终端或宿主应用被允许控制 Microsoft PowerPoint。"
            )
        raise RuntimeError(f"PowerPoint 导出 PDF 失败: {result}.{hint}")


def _export_pdf_via_libreoffice(pptx_path: Path, pdf_path: Path) -> None:
    """使用 LibreOffice 无头导出 PDF。"""
    binary = shutil.which("libreoffice") or shutil.which("soffice")
    if not binary:
        raise FileNotFoundError("未找到 libreoffice 或 soffice")

    out_dir = pdf_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [binary, "--headless", "--convert-to", "pdf", "--outdir", str(out_dir), str(pptx_path)],
        check=True,
        capture_output=True,
        text=True,
    )
    expected = out_dir / f"{pptx_path.stem}.pdf"
    if expected != pdf_path:
        if pdf_path.exists():
            pdf_path.unlink()
        expected.rename(pdf_path)


def _render_pdf_via_fitz(pdf_path: Path, output_dir: Path, prefix: str) -> list[Path]:
    """使用 PyMuPDF 把 PDF 渲染成 PNG。"""
    if fitz is None:
        raise RuntimeError("当前环境不可导入 fitz")

    output_dir.mkdir(parents=True, exist_ok=True)
    generated: list[Path] = []
    matrix = fitz.Matrix(2.0, 2.0)
    doc = fitz.open(pdf_path)
    try:
        for index, page in enumerate(doc):
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            out_path = output_dir / f"{prefix}{index + 1:03d}.png"
            pix.save(out_path)
            generated.append(out_path)
    finally:
        doc.close()
    return generated


def _render_pdf_via_pdftoppm(pdf_path: Path, output_dir: Path, prefix: str) -> list[Path]:
    """使用 pdftoppm 把 PDF 渲染成 PNG。"""
    binary = shutil.which("pdftoppm")
    if not binary:
        raise FileNotFoundError("未找到 pdftoppm")

    output_dir.mkdir(parents=True, exist_ok=True)
    temp_prefix = output_dir / "_preview_page"
    subprocess.run(
        [binary, "-png", str(pdf_path), str(temp_prefix)],
        check=True,
        capture_output=True,
        text=True,
    )

    generated: list[Path] = []
    for index, candidate in enumerate(sorted(output_dir.glob("_preview_page-*.png")), start=1):
        out_path = output_dir / f"{prefix}{index:03d}.png"
        if out_path.exists():
            out_path.unlink()
        candidate.rename(out_path)
        generated.append(out_path)
    return generated


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="把 PPTX 导出为逐页 PNG 预览图")
    parser.add_argument("--pptx", required=True, type=Path, help="输入 PPTX")
    parser.add_argument("--out-dir", required=True, type=Path, help="预览图输出目录")
    parser.add_argument(
        "--backend",
        choices=["auto", "powerpoint", "libreoffice"],
        default="auto",
        help="PPTX 到 PDF 的导出 backend",
    )
    parser.add_argument(
        "--render-backend",
        choices=["auto", "pdftoppm", "fitz"],
        default="auto",
        help="PDF 到 PNG 的渲染 backend",
    )
    parser.add_argument("--prefix", default="slide_", help="输出图片前缀，默认 slide_")
    parser.add_argument("--json-out", type=Path, help="可选：写出导出 manifest")
    parser.add_argument("--keep-pdf", action="store_true", help="保留中间 PDF")
    return parser.parse_args()


def main() -> int:
    """执行逐页预览导出。"""
    args = parse_args()
    pptx_path = args.pptx.resolve()
    out_dir = args.out_dir.resolve()

    if not pptx_path.exists():
        raise SystemExit(f"未找到 PPTX: {pptx_path}")

    pdf_backend = _select_pdf_backend(args.backend)
    render_backend = _select_render_backend(args.render_backend)
    expected_pages = len(Presentation(pptx_path).slides)

    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob(f"{args.prefix}*.png"):
        stale.unlink()

    temp_dir = Path(tempfile.mkdtemp(prefix="ppt_preview_export_"))
    pdf_path = temp_dir / f"{pptx_path.stem}.pdf"

    print(f"[INFO] pdf_backend={pdf_backend}")
    print(f"[INFO] render_backend={render_backend}")
    print(f"[INFO] expected_pages={expected_pages}")

    try:
        if pdf_backend == "powerpoint":
            with _powerpoint_export_lock():
                _export_pdf_via_powerpoint(pptx_path, pdf_path)
        else:
            _export_pdf_via_libreoffice(pptx_path, pdf_path)

        _wait_for_file(pdf_path)

        if render_backend == "pdftoppm":
            generated = _render_pdf_via_pdftoppm(pdf_path, out_dir, args.prefix)
        else:
            generated = _render_pdf_via_fitz(pdf_path, out_dir, args.prefix)

        if len(generated) != expected_pages:
            raise RuntimeError(
                f"预览页数不匹配: expected={expected_pages}, actual={len(generated)}, pptx={pptx_path.name}"
            )

        manifest = {
            "pptx": str(pptx_path),
            "out_dir": str(out_dir),
            "pdf_backend": pdf_backend,
            "render_backend": render_backend,
            "expected_pages": expected_pages,
            "generated_pages": len(generated),
            "files": [str(path) for path in generated],
        }

        if args.json_out:
            args.json_out.parent.mkdir(parents=True, exist_ok=True)
            args.json_out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"[INFO] 写入 JSON: {args.json_out}")

        print(f"[OK] 已导出 {len(generated)} 页预览图到 {out_dir}")
        return 0
    finally:
        if args.keep_pdf:
            kept = out_dir / f"{pptx_path.stem}.pdf"
            if pdf_path.exists():
                if kept.exists():
                    kept.unlink()
                shutil.move(str(pdf_path), str(kept))
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
