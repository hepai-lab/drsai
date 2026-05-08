"""Desktop shortcut installer for DrSai tray app.

Creates a Windows desktop shortcut (.lnk) with the cute robot icon
that launches ``drsai-tray`` (or ``python -m drsai.backend.gui.run_tray``).

Usage from Python:
    from drsai.backend.gui.shortcut_installer import install_desktop_shortcut
    install_desktop_shortcut()

Usage from CLI:
    python -m drsai.backend.gui.shortcut_installer
    python -m drsai.backend.gui.shortcut_installer --uninstall
"""

from __future__ import annotations

import os
import sys
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from loguru import logger


# ── Icon file management ──────────────────────────────────────────────────────

def get_icon_dir() -> Path:
    """Get the directory where DrSai stores its icon assets.

    Uses the DrSai workspace/config directory if available,
    otherwise falls back to a platform-appropriate location.
    """
    # Try DrSai workspace directory first
    try:
        from drsai.backend.common.config import FS_DIR
        icon_dir = Path(FS_DIR) / "icons"
    except (ImportError, AttributeError):
        # Fallback: user's AppData/Local/drsai/icons
        if sys.platform == "win32":
            icon_dir = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "drsai" / "icons"
        elif sys.platform == "darwin":
            icon_dir = Path.home() / ".drsai" / "icons"
        else:
            icon_dir = Path.home() / ".drsai" / "icons"

    icon_dir.mkdir(parents=True, exist_ok=True)
    return icon_dir


def ensure_icon_files() -> dict[str, Path]:
    """Generate and save icon files if they don't exist yet.

    Returns dict mapping file type → Path:
        - "ico":   .ico file (multi-resolution Windows icon)
        - "png64": 64x64 PNG (for tray icon at runtime)
        - "png256": 256x256 PNG (for other uses)
    """
    icon_dir = get_icon_dir()
    files = {
        "ico":    icon_dir / "drsai_robot.ico",
        "png64":  icon_dir / "drsai_robot_64.png",
        "png256": icon_dir / "drsai_robot_256.png",
    }

    # Check if all files exist and are non-empty
    all_exist = all(p.exists() and p.stat().st_size > 0 for p in files.values())
    if all_exist:
        logger.debug(f"Icon files already exist at {icon_dir}")
        return files

    # Generate icons
    logger.info(f"Generating DrSai robot icons at {icon_dir}...")
    try:
        from .icon_generator import draw_robot_icon, save_icon_set
        img = draw_robot_icon(256)
        saved = save_icon_set(img, str(icon_dir))

        # Map returned paths to our expected names
        for key, path_str in saved.items():
            saved_path = Path(path_str)
            # rename to our canonical names if needed
            if key == "ico" and saved_path != files["ico"]:
                shutil.move(str(saved_path), str(files["ico"]))
            elif key == "png_64" and saved_path != files["png64"]:
                shutil.move(str(saved_path), str(files["png64"]))
            elif key == "png_256" and saved_path != files["png256"]:
                shutil.move(str(saved_path), str(files["png256"]))

        logger.info(f"Icon files generated successfully")
    except Exception as e:
        logger.error(f"Failed to generate icon files: {e}")
        # Try to copy from package bundled icons
        pkg_icons = Path(__file__).parent / "icons"
        if pkg_icons.exists():
            for name, target in files.items():
                src_name = {"ico": "drsai_robot.ico", "png64": "drsai_robot_64.png", "png256": "drsai_robot_256.png"}[name]
                src = pkg_icons / src_name
                if src.exists() and not target.exists():
                    shutil.copy2(str(src), str(target))
                    logger.debug(f"Copied icon from package: {src} → {target}")

    return files


# ── Shortcut creation ─────────────────────────────────────────────────────────

def _find_drsai_tray_command() -> str:
    """Find the command to launch drsai-tray.

    Checks:
    1. ``drsai-tray`` entry point (if installed via pip)
    2. ``python -m drsai.backend.gui.run_tray`` (fallback)
    """
    # Check if drsai-tray entry point exists
    try:
        result = subprocess.run(
            ["where", "drsai-tray"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            exe_path = result.stdout.strip().splitlines()[0]
            logger.debug(f"Found drsai-tray entry point: {exe_path}")
            return exe_path
    except Exception:
        pass

    # Fallback: use python -m
    python_exe = sys.executable
    logger.debug(f"Using python -m fallback: {python_exe}")
    return python_exe


def _get_shortcut_target_args() -> tuple[str, str]:
    """Get (target_exe, arguments) for the shortcut.

    Returns:
        (target_path, args_string)
        e.g., ("C:\\Python312\\python.exe", "-m drsai.backend.gui.run_tray")
        or   ("C:\\...\\drsai-tray.exe", "")
    """
    tray_cmd = _find_drsai_tray_command()

    # If it's a standalone executable (drsai-tray script)
    if tray_cmd.endswith("drsai-tray") or tray_cmd.endswith("drsai-tray.exe"):
        return (tray_cmd, "")

    # Otherwise it's python.exe — pass -m argument
    return (tray_cmd, "-m drsai.backend.gui.run_tray")


def create_desktop_shortcut(
    shortcut_name: str = "DrSai",
    icon_path: Optional[str] = None,
    overwrite: bool = True,
) -> Path:
    """Create a Windows desktop shortcut (.lnk) for DrSai tray.

    Args:
        shortcut_name: Name of the shortcut file (without .lnk).
        icon_path:     Path to .ico file. Auto-detected if None.
        overwrite:     If True, replaces existing shortcut.

    Returns:
        Path to the created .lnk file.

    Raises:
        OSError: If shortcut creation fails.
    """
    if sys.platform != "win32":
        raise OSError("Desktop shortcuts are only supported on Windows currently.")

    # Ensure icon files exist
    icon_files = ensure_icon_files()
    if icon_path is None:
        icon_path = str(icon_files["ico"])

    # Get target command
    target_exe, arguments = _get_shortcut_target_args()

    # Desktop path
    desktop = Path(os.environ.get("USERPROFILE", Path.home())) / "Desktop"
    # On some Windows setups, OneDrive redirects Desktop
    onedrive_desktop = Path(os.environ.get("OneDriveConsumer", "")) / "Desktop"
    if onedrive_desktop.exists() and (desktop / "desktop.ini").exists() is False:
        # Use OneDrive desktop if it seems more active
        pass

    lnk_path = desktop / f"{shortcut_name}.lnk"

    if lnk_path.exists() and not overwrite:
        logger.info(f"Shortcut already exists: {lnk_path}")
        return lnk_path

    logger.info(f"Creating desktop shortcut: {lnk_path}")

    # Use PowerShell COM to create .lnk (most reliable on Windows)
    # Build PowerShell script with single-quoted strings to avoid escaping issues
    lnk_str       = str(lnk_path).replace("'", "''")
    target_str    = target_exe.replace("'", "''")
    args_str      = arguments.replace("'", "''")
    workdir_str   = str(Path(target_exe).parent).replace("'", "''")
    icon_str      = icon_path.replace("'", "''")

    ps_script = (
        "$ErrorActionPreference = 'Stop'\n"
        "$ws = New-Object -ComObject WScript.Shell\n"
        f"$sc = $ws.CreateShortcut('{lnk_str}')\n"
        f"$sc.TargetPath = '{target_str}'\n"
        f"$sc.Arguments = '{args_str}'\n"
        f"$sc.WorkingDirectory = '{workdir_str}'\n"
        f"$sc.IconLocation = '{icon_str}'\n"
        "$sc.Description = 'DrSai AI Agent - Desktop Assistant'\n"
        "$sc.Save()\n"
        "Write-Output 'OK'\n"
    )

    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_script],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0 or "OK" not in result.stdout:
            raise OSError(f"PowerShell shortcut creation failed: {result.stderr}")

        logger.info(f"Desktop shortcut created: {lnk_path}")
    except subprocess.TimeoutExpired:
        raise OSError("PowerShell shortcut creation timed out")
    except Exception as e:
        raise OSError(f"Failed to create desktop shortcut: {e}")

    return lnk_path


def remove_desktop_shortcut(shortcut_name: str = "DrSai") -> bool:
    """Remove the DrSai desktop shortcut if it exists.

    Returns:
        True if shortcut was removed, False if it didn't exist.
    """
    if sys.platform != "win32":
        return False

    desktop = Path(os.environ.get("USERPROFILE", Path.home())) / "Desktop"
    lnk_path = desktop / f"{shortcut_name}.lnk"

    if lnk_path.exists():
        try:
            lnk_path.unlink()
            logger.info(f"Removed desktop shortcut: {lnk_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to remove shortcut: {e}")
            return False

    return False


def install_desktop_shortcut() -> dict[str, str]:
    """Full installation: generate icon + create shortcut.

    Returns dict with status info:
        - "icon_dir":   Path to icon assets directory
        - "shortcut":   Path to .lnk file
        - "target":     The command the shortcut launches
        - "status":     "ok" or "error"
        - "message":    Human-readable status message
    """
    try:
        icon_files = ensure_icon_files()
        lnk_path = create_desktop_shortcut(icon_path=str(icon_files["ico"]))

        target_exe, args = _get_shortcut_target_args()
        launch_cmd = f"{target_exe} {args}".strip()

        return {
            "icon_dir": str(icon_files["ico"].parent),
            "shortcut": str(lnk_path),
            "target": launch_cmd,
            "status": "ok",
            "message": f"✅ 桌面快捷方式已创建！\n位置: {lnk_path}\n点击即可启动 DrSai 🤖",
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"❌ 创建快捷方式失败: {e}",
        }


def uninstall_desktop_shortcut() -> dict[str, str]:
    """Remove desktop shortcut (icons are kept for tray use).

    Returns dict with status info.
    """
    removed = remove_desktop_shortcut()
    if removed:
        return {
            "status": "ok",
            "message": "✅ 桌面快捷方式已删除",
        }
    else:
        return {
            "status": "ok",
            "message": "ℹ️ 桌面快捷方式不存在（无需删除）",
        }


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="DrSai desktop shortcut installer")
    parser.add_argument("--uninstall", action="store_true", help="Remove desktop shortcut")
    parser.add_argument("--ensure-icons", action="store_true", help="Only generate icon files, no shortcut")
    args = parser.parse_args()

    if args.uninstall:
        result = uninstall_desktop_shortcut()
    elif args.ensure_icons:
        files = ensure_icon_files()
        result = {"status": "ok", "message": f"Icon files:\n" + "\n".join(f"  {k}: {v}" for k, v in files.items())}
    else:
        result = install_desktop_shortcut()

    print(result["message"])
    if result["status"] == "error":
        sys.exit(1)