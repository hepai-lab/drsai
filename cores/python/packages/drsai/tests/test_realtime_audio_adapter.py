from __future__ import annotations

import pytest

from drsai.config.model_operation_adapters import ModelProtocolError
from drsai.config.realtime_audio_adapter import realtime_audio_url


def test_realtime_audio_url_uses_secure_openai_compatible_endpoint() -> None:
    assert realtime_audio_url("https://api.zhizengzeng.com/v1") == "wss://api.zhizengzeng.com/v1/realtime"
    assert realtime_audio_url("https://api.zhizengzeng.com") == "wss://api.zhizengzeng.com/v1/realtime"
    assert realtime_audio_url("http://127.0.0.1:9000/v1") == "ws://127.0.0.1:9000/v1/realtime"


@pytest.mark.parametrize("url", [
    "http://api.zhizengzeng.com/v1",
    "https://user:secret@api.zhizengzeng.com/v1",
    "https://api.zhizengzeng.com/v1?api_key=secret",
])
def test_realtime_audio_url_rejects_insecure_or_credential_bearing_url(url: str) -> None:
    with pytest.raises(ModelProtocolError):
        realtime_audio_url(url)
