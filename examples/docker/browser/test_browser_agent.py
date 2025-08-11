

# from src.magentic_ui.tools.playwright.browser.base_playwright_browser import (
#     DockerPlaywrightBrowser, PlaywrightBrowser)
# from src.magentic_ui.tools.playwright.playwright_controller import PlaywrightController

from pathlib import Path
here = Path(__file__).parent.resolve()

import asyncio
# from src.magentic_ui.agents.web_surfer._web_surfer import WebSurfer, WebSurferConfig
# from src.magentic_ui.tools.playwright.browser.utils import get_browser_resource_config
# from src.magentic_ui.magentic_ui_config import ModelClientConfigs

from drsai_ui.agent_factory.magentic_one.tools.playwright.browser.base_playwright_browser import (
    DockerPlaywrightBrowser, PlaywrightBrowser)
from drsai_ui.agent_factory.magentic_one.tools.playwright.browser import get_browser_resource_config
from drsai_ui.agent_factory.magentic_one.agents.web_surfer._web_surfer import WebSurfer, WebSurferConfig
from drsai_ui.agent_factory.magentic_one.magentic_ui_config import ModelClientConfigs


bind_path = Path(f"{here}/docker_test_dir_{hash(asyncio.get_event_loop().time()) % 10000}")
       
browser_resource_config, novnc_port, playwright_port = get_browser_resource_config(
    bind_path, -1, -1, False)

websurfer_model_client = ModelClientConfigs.get_default_client_config()
    
websurfer_config = WebSurferConfig(
        name="web_surfer",
        model_client=websurfer_model_client,
        browser=browser_resource_config,
        single_tab_mode=False,
        max_actions_per_step=5,
        url_statuses=None,
        url_block_list=None,
        multiple_tools_per_call=False,
        downloads_folder=str(bind_path),
        debug_dir=str(bind_path),
        animate_actions=True,
        start_page=None,
        use_action_guard=False,
        to_save_screenshots=False,
    )
web_surfer = WebSurfer.from_config(websurfer_config)

async def main():
    await web_surfer.lazy_init()
    print(f"WebSurfer started with browser at `http://localhost:{novnc_port}/vnc.html?autoconnect=true&amp;resize=scale&amp;show_dot=true&amp;scaling=local&amp;quality=7&amp;compression=0&amp;view_only=0`")

    pass

pass
    
    
if __name__ == "__main__":
    import asyncio
    asyncio.run(main())


