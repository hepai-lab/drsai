from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


def _libreoffice(source: Path, output: Path) -> bool:
    executable = shutil.which("libreoffice") or shutil.which("soffice")
    if not executable:
        return False
    subprocess.run([executable, "--headless", "--convert-to", "png", "--outdir", str(output), str(source)], check=True)
    return any(output.glob("*.png"))


def _powerpoint(source: Path, output: Path) -> bool:
    if sys.platform != "win32":
        return False
    try:
        import win32com.client  # type: ignore[import-not-found]
    except ImportError:
        return False
    application = win32com.client.DispatchEx("PowerPoint.Application")
    presentation = None
    try:
        presentation = application.Presentations.Open(str(source), WithWindow=False)
        presentation.Export(str(output), "PNG")
    finally:
        if presentation is not None:
            presentation.Close()
        application.Quit()
    return any(output.glob("*.PNG")) or any(output.glob("*.png"))


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: render_deck.py PRESENTATION.pptx OUTPUT_DIR", file=sys.stderr)
        return 2
    source = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if _libreoffice(source, output) or _powerpoint(source, output):
        return 0
    print("no supported presentation renderer is available", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
