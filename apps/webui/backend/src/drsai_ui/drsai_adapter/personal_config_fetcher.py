import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, cast

from loguru import logger

from hepai import HepAI
from hepai.types import APIKeyInfo
from drsai_ui.env_load import load_webui_dotenv
from drsai_ui.platform_config import get_active_platform

load_webui_dotenv()


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


SHARED_API_KEY_USER_SOURCES = frozenset({"science_user", "user_agent"})


def uses_shared_api_key(user_source: str | None) -> bool:
    """science_user / user_agent 走共享 key，不按个人账号去 HepAI 拉 key。"""
    return (user_source or "").strip() in SHARED_API_KEY_USER_SOURCES


def shared_api_key() -> str:
    return os.getenv("SCIENCE_USER_SHARED_API_KEY") or os.getenv("HEPAI_API_KEY") or ""


def should_fetch_personal_key() -> bool:
    """Fetch a per-user HepAI key when PROD is set or an admin key is available.

    SERVICE_MODE is often missing if only cwd/.env was loaded; an admin key
    is enough to call fetch_api_key and must not fall back to HEPAI_API_KEY.
    """
    mode = (os.getenv("SERVICE_MODE") or "").strip()
    if mode == "PROD":
        return True
    return bool((os.getenv("HEPAI_APP_ADMIN_API_KEY") or "").strip())


class PersonalKeyConfigFetcher:
    """获取个人密钥配置"""
    def __init__(self) -> None:
        self._hepai_base_url = get_active_platform().base_url
        self._client: Optional[HepAI] = None

    @property
    def service_mode(self) -> str | None:
        return os.getenv("SERVICE_MODE")

    @property
    def client(self) -> HepAI:
        if self._client is None:
            admin_api_key = os.getenv("HEPAI_APP_ADMIN_API_KEY")
            if not admin_api_key:
                raise RuntimeError(
                    "HEPAI_APP_ADMIN_API_KEY is not set, please set it in .env file"
                )
            self._client = HepAI(
                api_key=admin_api_key, base_url=self._hepai_base_url
            )
        return self._client

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
            user_source: 用户来源，"science_user" / "user_agent" 使用共享 key，不走 HepAI
        """
        if uses_shared_api_key(user_source):
            return shared_api_key()

        if should_fetch_personal_key():
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

        api_key = os.getenv("HEPAI_API_KEY", "hepai_api_key_not_found")
        if api_key == "hepai_api_key_not_found":
            logger.warning(
                "Using HEPAI_API_KEY in development mode, please set it in .env "
                "or environment variables in production mode"
            )
        else:
            logger.warning(
                "SERVICE_MODE is not PROD and HEPAI_APP_ADMIN_API_KEY is unset; "
                "returning shared HEPAI_API_KEY for {}",
                username,
            )
        return api_key
        
    
    def get_default_config(self, username: str, user_source: str | None = None) -> Dict[str, Any]:
        """获取默认配置

        Args:
            username: 用户标识（邮箱）
            user_source: 用户来源，"science_user" / "user_agent" 使用共享 key
        """
        # "openai/gpt-4.1"
        personal_key = self.get_personal_key(username=username, user_source=user_source)
        default_model_configs = f"""model_config: &client
  provider: drsai.HepAIChatCompletionClient
  config:
    model: "openai/gpt-4.1"
    base_url: "{self._hepai_base_url}"
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

