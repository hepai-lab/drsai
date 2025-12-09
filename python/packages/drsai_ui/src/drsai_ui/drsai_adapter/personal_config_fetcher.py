import os
from typing import Dict, Any
from dotenv import load_dotenv
load_dotenv()
from loguru import logger
from hepai import HepAI
from hepai.types import APIKeyInfo

class PersonalKeyConfigFetcher:
    """获取个人密钥配置"""
    def __init__(self):
        self.service_mode = os.getenv("SERVICE_MODE")
        if self.service_mode == "PROD":
            
            admin_api_key = os.getenv("HEPAI_APP_ADMIN_API_KEY")  # 从环境变量中读取API-KEY
            base_url = "https://aiapi.ihep.ac.cn/apiv2"
            assert admin_api_key, "HEPAI_APP_ADMIN_API_KEY is not set, please set it in .env file"
            self.client = HepAI(api_key=admin_api_key, base_url=base_url)

    def get_personal_key(self, username: str) -> str:
        """获取个人密钥"""
        
        if self.service_mode == "PROD":
            api_key: APIKeyInfo = self.client.fetch_api_key(username=username)
            if not api_key or not api_key.api_key:
                raise ValueError(f"API key for user {username} not found.")
            return api_key.api_key
        else:
            api_key = os.getenv("HEPAI_API_KEY", "hepai_api_key_not_found")
            # assert api_key, "HEPAI_API_KEY not found, please add it in .env or environment variables in development mode"
            if api_key == "hepai_api_key_not_found":
                logger.warning("Using HEPAI_API_KEY in development mode, please set it in .env or environment variables in production mode")
            return api_key
        
    
    def get_default_config(self, username: str) -> Dict[str, Any]:
        """获取默认配置"""
        
        # "openai/gpt-4.1"
        personal_key = self.get_personal_key(username=username)
        default_model_configs = f"""model_config: &client
  provider: drsai.HepAIChatCompletionClient
  config:
    model: "openai/gpt-4.1"
    base_url: "https://aiapi.ihep.ac.cn/apiv2"
    api_key: "{personal_key}"
    max_retries: 10

coder_client: *client
orchestrator_client: *client
web_surfer_client: *client
file_surfer_client: *client
action_guard_client: *client
"""

        return {
            "cooperative_planning": True,
            "autonomous_execution": False,
            "allowed_websites": [],
            "max_actions_per_step": 5,
            "multiple_tools_per_call": False,
            "max_turns": 20,
            "approval_policy": "auto-conservative",
            "allow_for_replans": True,
            "do_bing_search": False,
            "websurfer_loop": False,
            "model_configs": default_model_configs,
            "retrieve_relevant_plans": "never"
        }

