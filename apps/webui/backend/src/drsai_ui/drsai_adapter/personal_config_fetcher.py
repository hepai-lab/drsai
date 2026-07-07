import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, cast

from dotenv import load_dotenv

load_dotenv()
from loguru import logger

from hepai import HepAI
from hepai.types import APIKeyInfo


def _extract_api_key_from_json(obj: object) -> Optional[str]:
    """Best-effort parse HepAI fetch_api_key JSON when SDK model lags behind API (e.g. ext_data)."""
    if isinstance(obj, dict):
        raw_key = obj.get("api_key")
        if isinstance(raw_key, str) and raw_key.strip():
            return raw_key.strip()
        for k in ("data", "result", "payload"):
            if k in obj:
                nested = _extract_api_key_from_json(obj[k])
                if nested:
                    return nested
    return None


SCIENCE_USER_SHARED_API_KEY = os.getenv("SCIENCE_USER_SHARED_API_KEY", os.getenv("HEPAI_API_KEY", ""))


class PersonalKeyConfigFetcher:
    """获取个人密钥配置"""
    def __init__(self) -> None:
        self.service_mode = os.getenv("SERVICE_MODE")
        self._hepai_base_url = os.getenv(
            "HEPAI_BASE_URL", "https://aiapi.ihep.ac.cn/apiv2"
        ).rstrip("/")
        if self.service_mode == "PROD":
            admin_api_key = os.getenv("HEPAI_APP_ADMIN_API_KEY")
            assert admin_api_key, (
                "HEPAI_APP_ADMIN_API_KEY is not set, please set it in .env file"
            )
            self.client = HepAI(
                api_key=admin_api_key, base_url=self._hepai_base_url
            )

    def _fetch_personal_key_raw(self, username: str) -> str:
        """
        Same endpoint as hepai Key.fetch_api_key, via raw HTTP
        (avoids SDK model mismatch e.g. unexpected keyword 'ext_data').
        """
        admin_api_key = os.environ["HEPAI_APP_ADMIN_API_KEY"]
        key = self.client.key
        prefix = str(getattr(key, "prefix", "") or "").strip("/")
        rel = f"{prefix}/fetch_api_key" if prefix else "fetch_api_key"
        url = f"{self._hepai_base_url}/{rel}"
        body = json.dumps({"username": username}).encode("utf-8")
        auth_header = os.getenv("HEPAI_ADMIN_AUTHORIZATION_HEADER")
        if auth_header:
            authorization = auth_header
        elif admin_api_key.lower().startswith("bearer "):
            authorization = admin_api_key
        else:
            authorization = f"Bearer {admin_api_key}"

        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": authorization,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw_bytes = resp.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"HepAI fetch_api_key HTTP {exc.code}: {detail}"
            ) from exc

        payload = json.loads(raw_bytes.decode("utf-8"))
        token = _extract_api_key_from_json(payload)
        if not token:
            raise ValueError(
                f"API key for user {username} not found (raw HTTP, unexpected JSON shape)."
            )
        return token

    def get_personal_key(self, username: str, user_source: str | None = None) -> str:
        """获取个人密钥

        Args:
            username: 用户标识（邮箱）
            user_source: 用户来源，"science_user" 使用共享 key，不走 HepAI
        """
        if user_source == "science_user":
            return SCIENCE_USER_SHARED_API_KEY

        if self.service_mode == "PROD":
            try:
                api_key = self.client.fetch_api_key(username=username)
            except TypeError as exc:
                err = str(exc).lower()
                if "ext_data" not in err and "unexpected keyword" not in err:
                    raise
                logger.warning(
                    "HepAI fetch_api_key model mismatch ({}); using raw HTTP fallback",
                    exc,
                )
                return self._fetch_personal_key_raw(username)

            if not api_key or not getattr(api_key, "api_key", None):
                return self._fetch_personal_key_raw(username)
            return cast(APIKeyInfo, api_key).api_key
        else:
            api_key = os.getenv("HEPAI_API_KEY", "hepai_api_key_not_found")
            # assert api_key, "HEPAI_API_KEY not found, please add it in .env or environment variables in development mode"
            if api_key == "hepai_api_key_not_found":
                logger.warning("Using HEPAI_API_KEY in development mode, please set it in .env or environment variables in production mode")
            return api_key
        
    
    def get_default_config(self, username: str, user_source: str | None = None) -> Dict[str, Any]:
        """获取默认配置

        Args:
            username: 用户标识（邮箱）
            user_source: 用户来源，"science_user" 使用共享 key
        """
        # "openai/gpt-4.1"
        personal_key = self.get_personal_key(username=username, user_source=user_source)
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

