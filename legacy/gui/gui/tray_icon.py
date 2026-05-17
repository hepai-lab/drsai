"""System tray icon manager for DrSai desktop app.

Uses ``pystray`` to create a persistent Windows system tray icon.
- Double-click tray icon OR menu "打开对话" → show chat window
- Menu "配置" → open setup/re-configuration dialog (if setup_fn provided)
- Menu "退出" → quit entire application

The tray icon runs in its own thread (pystray requirement) and
communicates with the main tkinter GUI thread via callbacks.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from loguru import logger

try:
    import pystray
    from PIL import Image
    HAS_PYSTRAY = True
except ImportError:
    HAS_PYSTRAY = False

def _check_pystray_available() -> bool:
    """Re-check if pystray and PIL are importable at runtime.

    This is needed because HAS_PYSTRAY is set at module import time.
    If the module was imported before pystray was installed, HAS_PYSTRAY
    would be False even though pystray is now available.
    """
    try:
        import pystray  # noqa: F401
        from PIL import Image  # noqa: F401
        return True
    except ImportError:
        return False


# ── Icon image ────────────────────────────────────────────────────────────────

def _create_default_icon() -> "Image.Image":
    """Create a cute cartoon AI robot icon (64x64 for tray).

    Falls back to a solid-color square if PIL.ImageDraw is unavailable.
    The design features:
    - Round head with soft blue gradient effect
    - Two big cute eyes (white sclera + blue iris + white reflection)
    - Happy smile arc
    - Antenna with glowing orange tip
    - Small rounded ear panels on sides
    - Pinkish cheek blush dots for cuteness
    """
    width, height = 64, 64
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    try:
        from .icon_generator import draw_robot_icon
        robot = draw_robot_icon(256)
        return robot.resize((width, height), Image.LANCZOS)
    except Exception as e:
        logger.debug(f"Failed to generate robot icon, falling back to simple icon: {e}")

    # Fallback: simple blue circle with 'D'
    try:
        from PIL import ImageDraw, ImageFont
        draw = ImageDraw.Draw(img)

        # Draw a rounded blue circle background
        margin = 4
        draw.ellipse(
            [margin, margin, width - margin, height - margin],
            fill=(0, 120, 200, 230),
            outline=(255, 255, 255, 180),
            width=2,
        )

        # Draw 'D' letter in white
        try:
            font = ImageFont.truetype("arial.ttf", size=32)
        except (IOError, OSError):
            font = ImageFont.load_default()

        text = "D"
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        x = (width - text_w) // 2
        y = (height - text_h) // 2 - 2
        draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)
    except Exception:
        # Fallback: solid blue square
        img = Image.new("RGBA", (width, height), (0, 120, 200, 230))

    return img


def _load_custom_icon(path: Optional[str] = None) -> "Image.Image":
    """Load a custom .ico/.png icon, or create the default one."""
    if path and Path(path).exists():
        try:
            return Image.open(path).convert("RGBA").resize((64, 64))
        except Exception as e:
            logger.warning(f"Failed to load icon from {path}: {e}")

    return _create_default_icon()


# ── Tray application ──────────────────────────────────────────────────────────

class DrSaiTrayApp:
    """System tray icon + lifecycle manager.

    Responsibilities:
    1. Create and manage the pystray icon (runs in its own thread).
    2. Provide callbacks for show-window, setup, and quit actions.
    3. Coordinate shutdown between tray thread and GUI thread.

    Usage:
        app = DrSaiTrayApp(show_window_fn=my_show, setup_fn=my_setup, quit_fn=my_quit)
        app.run()  # blocks until icon.stop() is called
    """

    def __init__(
        self,
        *,
        show_window_fn: Callable[[], None],
        quit_fn: Callable[[], None],
        setup_fn: Optional[Callable[[], None]] = None,
        icon_path: Optional[str] = None,
        title: str = "DrSai Agent",
    ) -> None:
        # Re-check pystray availability at runtime (not module-level)
        if not _check_pystray_available():
            raise ImportError(
                "pystray and Pillow are required for the tray icon.\n"
                "Install them: pip install drsai[tray]  or  pip install pystray Pillow"
            )

        self._show_window_fn = show_window_fn
        self._quit_fn = quit_fn
        self._setup_fn = setup_fn
        self._title = title
        self._icon_path = icon_path
        self._icon: Optional[pystray.Icon] = None
        self._running = False

    # ── Menu callbacks ─────────────────────────────────────────────────────
    def _on_show_window(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        """Menu: 打开对话 → show the chat window."""
        logger.debug("Tray: show window requested via menu")
        try:
            self._show_window_fn()
        except Exception as e:
            logger.error(f"Failed to show window: {e}")

    def _on_setup(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        """Menu: 配置 → open the setup dialog for re-configuration."""
        logger.debug("Tray: setup requested via menu")
        if self._setup_fn:
            try:
                self._setup_fn()
            except Exception as e:
                logger.error(f"Failed to open setup dialog: {e}")

    def _on_quit(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        """Menu: 退出 → quit the app.

        NOTE: We do NOT call icon.stop() here because:
        1. icon.stop() blocks the pystray thread's message loop, which
           prevents our _quit_fn callback from being dispatched properly.
        2. The _quit_fn (DrSaiDesktopApp._on_quit) handles the full
           shutdown sequence including tray icon cleanup.
        3. Calling icon.stop() from the pystray callback thread can cause
           a deadlock where stop() waits for the message loop to exit,
           but the message loop is stuck running this callback.

        Instead, we just call _quit_fn and let it manage the entire
        shutdown from a safe thread context.
        """
        logger.info("Tray: quit requested")
        self._running = False
        try:
            self._quit_fn()
        except Exception as e:
            logger.error(f"Failed to quit via _quit_fn: {e}")
            # If _quit_fn fails, force exit
            try:
                icon.stop()
            except Exception:
                pass
            os._exit(0)

    # ── Icon creation ──────────────────────────────────────────────────────
    def _create_icon(self) -> pystray.Icon:
        """Build the pystray.Icon with menu and image."""
        image = _load_custom_icon(self._icon_path)

        # default=True means: double-click tray icon triggers this item
        # (On Windows: left-double-click → 打开对话; right-click → menu)
        menu_items = [
            pystray.MenuItem("打开对话", self._on_show_window, default=True),
        ]
        if self._setup_fn:
            menu_items.append(pystray.MenuItem("配置", self._on_setup))
        menu_items.append(pystray.MenuItem("退出", self._on_quit))
        menu = pystray.Menu(*menu_items)

        icon = pystray.Icon(
            name="DrSai",
            icon=image,
            title=self._title,
            menu=menu,
        )

        return icon

    # ── Public API ─────────────────────────────────────────────────────────
    def run_detached(self) -> None:
        """Start tray icon in background using pystray's built-in run_detached.

        This is more reliable on Windows than manual threading because
        pystray's run_detached() properly sets up the Win32 message loop
        in a background thread with the correct message queue.

        Note: Unlike our previous custom threading, this does NOT return
        a thread object. The icon runs until icon.stop() is called.
        """
        if self._icon is None:
            self._icon = self._create_icon()

        self._running = True
        logger.info("DrSai tray icon starting (detached)...")
        # pystray's own run_detached handles the Win32 message loop correctly
        self._icon.run_detached()
        logger.info("Tray icon thread launched — icon will become visible once pystray setup completes")

        # ── Deferred diagnostic: poll _visible without blocking caller ──────
        # pystray's run_detached() spawns a setup_thread that asynchronously
        # sets self.visible = True (which sets _visible = True).  Checking
        # _visible immediately after run_detached() is unreliable because
        # the setup_thread may not have executed yet.  Instead, we launch a
        # background poll that waits up to 5 seconds and logs the result.
        _diag_icon = self._icon  # capture for closure
        def _visibility_poll(max_wait: float = 5.0, step: float = 0.2) -> None:
            elapsed = 0.0
            while elapsed < max_wait:
                time.sleep(step)
                elapsed += step
                try:
                    if hasattr(_diag_icon, '_visible') and _diag_icon._visible:
                        logger.info(f"Tray icon confirmed visible after {elapsed:.1f}s")
                        return
                except Exception:
                    pass
            # Final check after timeout
            try:
                if hasattr(_diag_icon, '_visible'):
                    visible = _diag_icon._visible
                    if not visible:
                        logger.warning(
                            "Tray icon reports _visible=False after %.1fs. "
                            "The icon may be in the overflow area (click ↑ in taskbar).",
                            elapsed,
                        )
                    else:
                        logger.info(f"Tray icon visible (late confirmation at {elapsed:.1f}s)")
                if hasattr(_diag_icon, '_icon_valid'):
                    logger.info(f"Tray icon valid: {_diag_icon._icon_valid}")
                if hasattr(_diag_icon, '_hwnd'):
                    logger.info(f"Tray icon HWND: {_diag_icon._hwnd}")
            except Exception as e:
                logger.debug(f"Tray icon diagnostic check failed: {e}")

        threading.Thread(target=_visibility_poll, daemon=True, name="tray-visibility-diag").start()

    def stop(self) -> None:
        """Stop the tray icon (called from any thread, idempotent)."""
        if not self._running:
            return  # Already stopped — no-op
        self._running = False
        if self._icon:
            try:
                self._icon.stop()
            except Exception as e:
                logger.warning(f"Error stopping tray icon: {e}")

    def update_title(self, title: str) -> None:
        """Update the tray icon tooltip title."""
        if self._icon:
            self._icon.title = title

    def notify(self, message: str, title: str = "") -> None:
        """Show a balloon/notification popup from the tray icon.

        Args:
            message: Notification body text.
            title:   Notification title (shown above the message).
        """
        if self._icon:
            try:
                self._icon.notify(message, title or self._title)
            except Exception as e:
                logger.debug(f"Tray notification failed: {e}")

    @property
    def is_running(self) -> bool:
        return self._running