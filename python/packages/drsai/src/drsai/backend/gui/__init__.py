"""DrSai GUI backend — system tray icon + tkinter chat window.

Provides a desktop application experience:
- Windows system tray icon (pystray) — always visible
- Left-click or menu "打开对话" → popup chat window
- Close window → minimize to tray (not quit)
- Agent stays resident in memory for instant response

Usage:
    python -m drsai.backend.run_tray
    or:  drsai-tray  (if registered as entry point)
"""

from .chat_window import DrSaiChatWindow
from .gui_renderer import DrSaiGUIRenderer
from .icon_generator import draw_robot_icon
from .tray_icon import DrSaiTrayApp

__all__ = ["DrSaiChatWindow", "DrSaiGUIRenderer", "DrSaiTrayApp", "draw_robot_icon"]