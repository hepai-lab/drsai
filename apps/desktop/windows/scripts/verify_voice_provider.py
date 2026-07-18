import os

from fastapi.testclient import TestClient

import drsai.backend.gateway as gateway


class FakeResponse:
    def __init__(self, status_code=200, payload=None, invalid_json=False):
        self.status_code = status_code
        self._payload = payload or {}
        self._invalid_json = invalid_json

    def json(self):
        if self._invalid_json:
            raise ValueError("invalid json")
        return self._payload


class FakeAsyncClient:
    response = FakeResponse(200, {"text": "hello voice", "language": "en"})

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, *_args, **_kwargs):
        return self.response


client = TestClient(gateway.app)
original_client = gateway.httpx.AsyncClient
original_key = os.environ.get("HEPAI_API_KEY")
try:
    gateway.httpx.AsyncClient = FakeAsyncClient
    os.environ.pop("HEPAI_API_KEY", None)
    os.environ.pop("OPENAI_API_KEY", None)
    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"RIFFdata", "audio/wav")})
    assert response.status_code == 401, response.text

    os.environ["HEPAI_API_KEY"] = "test-only-key"
    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"", "audio/wav")})
    assert response.status_code == 400, response.text

    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"x" * (10 * 1024 * 1024 + 1), "audio/wav")})
    assert response.status_code == 413, response.text

    FakeAsyncClient.response = FakeResponse(200, {"text": "hello voice", "language": "en"})
    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"RIFFdata", "audio/wav")})
    assert response.status_code == 200, response.text
    assert response.json()["text"] == "hello voice"

    FakeAsyncClient.response = FakeResponse(429, {"error": {"message": "slow down"}})
    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"RIFFdata", "audio/wav")})
    assert response.status_code == 429, response.text

    FakeAsyncClient.response = FakeResponse(500, {"error": {"message": "provider down"}})
    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"RIFFdata", "audio/wav")})
    assert response.status_code == 500, response.text

    FakeAsyncClient.response = FakeResponse(200, invalid_json=True)
    response = client.post("/v1/audio/transcriptions", files={"file": ("voice.wav", b"RIFFdata", "audio/wav")})
    assert response.status_code == 502, response.text
finally:
    gateway.httpx.AsyncClient = original_client
    if original_key is None:
        os.environ.pop("HEPAI_API_KEY", None)
    else:
        os.environ["HEPAI_API_KEY"] = original_key

print("Voice provider behavior tests passed (7 cases).")
