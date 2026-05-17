"""DrSai GUI backend — system tray icon + tkinter chat window.

Provides a desktop application experience:
- Windows system tray icon (pystray) — always visible
- Left-click or menu "打开对话" → popup chat window
- Close window → minimize to tray (not quit)
- Agent stays resident in memory for instant response

Architecture (refactored from monolithic run_tray.py):
    app_context.py      — AppContext: shared state container
    desktop_app.py      — DrSaiDesktopApp: orchestrator
    commands/            — CommandDispatcher + 6 category modules
    lazy_imports.py      — centralized lazy import cache
    ui_formatter.py      — UIFormatter: standardized output
    crash_logging.py     — crash log, excepthook, checks
    setup_dialog.py      — DrSaiSetupDialog: first-time setup UI
    run_tray.py          — thin entry point (__main__)

Usage:
    python -m drsai.backend.gui.run_tray
    or:  drsai-tray  (if registered as entry point)
"""

# Lazy imports — avoid triggering tkinter at package import time
# (tkinter may not be available in headless/test environments)
def __getattr__(name):
    """Lazy module-level imports to avoid tkinter dependency at import time."""
    _lazy_map = {
        "DrSaiChatWindow": ".chat_window",
        "DrSaiGUIRenderer": ".gui_renderer",
        "draw_robot_icon": ".icon_generator",
        "DrSaiTrayApp": ".tray_icon",
        "AppContext": ".app_context",
        "UIFormatter": ".ui_formatter",
        "DrSaiDesktopApp": ".desktop_app",
    }
    if name in _lazy_map:
        import importlib
        module = importlib.import_module(_lazy_map[name], __package__)
        return getattr(module, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "DrSaiChatWindow",
    "DrSaiGUIRenderer",
    "DrSaiTrayApp",
    "draw_robot_icon",
    "AppContext",
    "UIFormatter",
    "DrSaiDesktopApp",
]