from __future__ import annotations

import asyncio

from drsai.backend.run import classify_lazy_init_error, lazy_init_failure_payload
from drsai.modules.agents.drsai_worker_agent import (
    lazy_init_user_message,
    welcome_from_remote_lazy_init,
)


def test_classify_lazy_init_error_codes() -> None:
    assert classify_lazy_init_error(KeyError("hepai/deepseek-v4-flash")) == "model_not_found"
    assert classify_lazy_init_error(TimeoutError()) == "timeout"
    assert classify_lazy_init_error(asyncio.TimeoutError()) == "timeout"
    assert classify_lazy_init_error(ConnectionRefusedError()) == "worker_unavailable"
    assert classify_lazy_init_error(RuntimeError("boom")) == "init_failed"


def test_lazy_init_failure_payload_uses_friendly_message() -> None:
    payload = lazy_init_failure_payload(KeyError("hepai/deepseek-v4-flash"))
    assert payload["status"] is False
    assert payload["error"] == "model_not_found"
    assert payload["detail"] == "'hepai/deepseek-v4-flash'"
    assert payload["message"] == lazy_init_user_message("model_not_found")
    assert "hepai/deepseek-v4-flash" not in payload["message"]
    assert "KeyError" not in payload["message"]


def test_welcome_from_remote_lazy_init_rewrites_legacy_errors() -> None:
    rewritten = welcome_from_remote_lazy_init(
        {
            "status": False,
            "message": "Lazy init error: 'hepai/deepseek-v4-flash'",
        },
        "DocMaster",
    )
    assert rewritten == lazy_init_user_message("init_failed")
    assert "Lazy init error" not in rewritten


def test_welcome_from_remote_lazy_init_maps_error_code_when_message_missing() -> None:
    assert welcome_from_remote_lazy_init(
        {
            "status": False,
            "message": None,
            "error": "model_not_found",
            "detail": "'hepai/deepseek-v4-flash'",
        },
        "DocMaster",
    ) == lazy_init_user_message("model_not_found")


def test_welcome_from_remote_lazy_init_keeps_friendly_failure_message() -> None:
    friendly = lazy_init_user_message("timeout")
    assert welcome_from_remote_lazy_init(
        {
            "status": False,
            "message": friendly,
            "error": "timeout",
            "detail": "timed out",
        },
        "DocMaster",
    ) == friendly


def test_welcome_from_remote_lazy_init_keeps_success_payload() -> None:
    welcome = {"content": "OpenDrSai is ready to serve you!", "metadata": {}}
    assert welcome_from_remote_lazy_init(
        {"status": True, "message": welcome},
        "DocMaster",
    ) == welcome
    assert welcome_from_remote_lazy_init(
        {"status": True, "message": None},
        "DocMaster",
    ) is None
