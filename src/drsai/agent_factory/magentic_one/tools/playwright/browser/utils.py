from pathlib import Path
from typing import Tuple
import socket
from autogen_core import ComponentModel
from .vnc_docker_playwright_browser import VncDockerPlaywrightBrowser

import random

def get_available_port(min_port: int = 40000, max_port: int = 65000) -> tuple[int, socket.socket]:
    """
    Get an available port on the local machine.
    """
    # s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    # s.bind(("127.0.0.1", 0))
    # port = s.getsockname()[1]
    # return port, s

    max_attempts = 100  # 最大随机尝试次数
    for _ in range(max_attempts):
        port = random.randint(min_port, max_port)
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.bind(("127.0.0.1", port))
            return port, s
        except OSError:
            s.close()

    # 如果随机尝试失败，改为顺序扫描
    for port in range(min_port, max_port):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.bind(("127.0.0.1", port))
            return port, s
        except OSError:
            s.close()
    
    raise OSError(f"No available ports in range {min_port}-{max_port}")


def get_browser_resource_config(
    bind_dir: Path,
    novnc_port: int = -1,
    playwright_port: int = -1,
    inside_docker: bool = True,
) -> Tuple[ComponentModel, int, int]:
    """
    Create a VNC Docker Playwright Browser Resource configuration. The requested ports for novnc and playwright may be overwritten. The final values for each port number will be in the return value.

    Args:
        bind_dir (str): Directory to bind for the browser resource.
        novnc_port (int, optional): Port for the noVNC server. Default: -1 (auto-assign).
        playwright_port (int, optional): Port for the Playwright browser. Default: -1 (auto-assign).

    Returns:
        A tuple containing the following:
            - VncDockerPlaywrightBrowserResource: Configured browser resource.
            - int: Port number for the noVNC server.
            - int: Port number for the Playwright browser.
    """
    opened_sockets: list[socket.socket] = []

    if novnc_port == -1:
        novnc_port, sock = get_available_port()
        opened_sockets.append(sock)
    if playwright_port == -1:
        playwright_port, sock = get_available_port()
        opened_sockets.append(sock)

    # Close the sockets after getting the ports
    for sock in opened_sockets:
        sock.close()

    return (
        VncDockerPlaywrightBrowser(
            bind_dir=bind_dir,
            playwright_port=playwright_port,
            novnc_port=novnc_port,
            inside_docker=inside_docker,
        ).dump_component(),
        novnc_port,
        playwright_port,
    )
