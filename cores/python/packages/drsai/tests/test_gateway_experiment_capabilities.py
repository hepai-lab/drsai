from __future__ import annotations

import asyncio

from drsai.backend import gateway
from drsai.backend.runtime.experiments import UnsupportedExperimentOverrides


class _AgentService:
    async def health(self):
        return {"opendrsai": {"available": True}}

    async def backend_model_catalog(self, backend_id: str, *, refresh: bool = False):
        assert backend_id == "opendrsai"
        assert refresh is False
        return {
            "models": [
                {"id": "model-b", "display_name": "Model B", "hidden": False},
                {"id": "model-a", "display_name": "Model A", "default": True},
                {"id": "model-hidden", "hidden": True},
                {"display_name": "Missing identity"},
            ],
        }


def test_runtime_capabilities_advertise_truthful_experiment_contract(monkeypatch) -> None:
    service = _AgentService()
    monkeypatch.setattr(gateway, "_runtime_agent_service", lambda: service)
    capabilities = asyncio.run(gateway.runtime_capabilities())
    experiment = capabilities["run_experiments"]
    assert experiment["schema_version"] == "opendrsai.run-experiment-capabilities/1"
    assert experiment["supported_override_fields"] == ["attachments", "input", "model"]
    assert experiment["supported_model_fields"] == ["model_id", "provider_id"]
    assert experiment["default_replay_modes"] == ["rerun_from_start"]
    assert experiment["advanced_replay_modes"] == []


def test_run_capabilities_use_backend_catalog_and_hide_unavailable_models(monkeypatch) -> None:
    monkeypatch.setattr(gateway, "_runtime_agent_service", lambda: _AgentService())
    result = asyncio.run(gateway._run_experiment_capabilities({
        "run_id": "run-one", "backend_id": "opendrsai",
    }))
    assert result["available_model_refs"] == ["opendrsai/model-a", "opendrsai/model-b"]
    assert [item["model_id"] for item in result["models"]] == ["model-a", "model-b"]
    assert result["models"][0]["default"] is True
    assert result["catalog_error"] is None


def test_unsupported_override_has_stable_http_error_code() -> None:
    response = gateway._experiment_http_error(
        UnsupportedExperimentOverrides("Unsupported override fields: skills")
    )
    assert response.status_code == 400
    assert response.detail == {
        "code": "unsupported_override",
        "message": "Unsupported override fields: skills",
    }
