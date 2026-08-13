"""
Dependency management utilities for DocMaster.
Handles auto-installation of Python dependencies.
"""

from pathlib import Path
import subprocess


def ensure_python_deps(here_path: Path) -> bool:
    """
    Install missing Python packages from requirements.txt at startup.

    Special handling: rapidocr_onnxruntime declares opencv-python as a dependency,
    but we need opencv-python-headless on headless servers (no libGL.so.1). After
    install, we forcibly swap opencv-python → opencv-python-headless if present.

    Args:
        here_path: Path to the directory containing requirements.txt

    Returns:
        True if dependencies were installed or already present, False otherwise
    """
    req_file = Path(here_path) / "requirements.txt"
    if not req_file.exists():
        return True

    try:
        result = subprocess.run(
            ["pip", "install", "-r", str(req_file), "--quiet"],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            print("✅ Python dependencies installed from requirements.txt")
        else:
            print(f"⚠️ Some Python dependencies could not be installed: {result.stderr[:200]}")
            return False

        # Post-install fix: swap opencv-python → opencv-python-headless if pip
        # auto-installed the GUI variant as a transitive dependency.
        list_result = subprocess.run(
            ["pip", "list"], capture_output=True, text=True, timeout=30
        )
        has_gui = any(
            line.startswith("opencv-python ") for line in list_result.stdout.splitlines()
        )
        if has_gui:
            print("🔧 Detected opencv-python (GUI variant) — swapping for headless")
            subprocess.run(
                ["pip", "uninstall", "-y", "opencv-python"],
                capture_output=True, text=True, timeout=60
            )
            subprocess.run(
                ["pip", "install", "--force-reinstall", "--no-deps", "opencv-python-headless"],
                capture_output=True, text=True, timeout=120
            )
            print("✅ opencv-python-headless restored")

        return True

    except Exception as e:
        print(f"⚠️ Could not run pip install: {e}")
        return False
