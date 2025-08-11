from drsai_ui.agent_factory.magentic_one.tools.playwright.browser.vnc_docker_playwright_browser import VncDockerPlaywrightBrowser
from drsai_ui.agent_factory.magentic_one.tools.playwright.browser import get_browser_resource_config
from loguru import logger
from pathlib import Path
import asyncio



async def test_browser_docker():
    bind_dir = Path("/home/xiongdb/.drsai_ui/files/user/xiongdb@ihep.ac.cn/23/23")
    novnc_port = 51156
    playwright_port = 61248
    inside_docker = False
    
    browser_resource_config, _novnc_port, _playwright_port = (
        get_browser_resource_config(
            bind_dir = bind_dir,
            novnc_port = novnc_port,
            playwright_port = playwright_port,
            inside_docker = inside_docker,
        )
    )
    browser=VncDockerPlaywrightBrowser.load_component(browser_resource_config)
    
    if isinstance(browser, VncDockerPlaywrightBrowser):
        await browser.__aenter__()  # 启动浏览器
        novnc_port = browser.novnc_port
        playwright_port = browser.playwright_port
        
        # 启动后显示连接地址：
        logger.info(
            f"WebSurfer started with browser at `http://localhost:{browser._novnc_port}/vnc.html?autoconnect=true&amp;resize=scale&amp;show_dot=true&amp;scaling=local&amp;quality=7&amp;compression=0&amp;view_only=0`"
        )
    
    pass

if __name__ == "__main__":
    asyncio.run(test_browser_docker())
