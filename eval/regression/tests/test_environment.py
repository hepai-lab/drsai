from pathlib import Path
import json

import pytest

from opendrsai_regression.case_loader import CaseCatalog
from opendrsai_regression.environment import EnvironmentError, EnvironmentProvisioner, directory_digest, safe_join


ROOT = Path(__file__).resolve().parents[1]


def test_workspace_fixture_is_isolated_and_digest_is_stable(tmp_path: Path) -> None:
    case = CaseCatalog(ROOT).load_cases()["workspace.readonly.diagnose"]
    provisioner = EnvironmentProvisioner(ROOT, tmp_path)
    with provisioner.prepare(case) as environment:
        assert (environment.workspace / "src" / "runtime_metrics.py").is_file()
        assert directory_digest(environment.workspace) == case.data["environment"]["workspace"]["fixture_sha256"]
        (environment.workspace / "local-only.txt").write_text("isolated", encoding="utf-8")
    source = ROOT / "assets" / "workspaces" / "readonly_diagnosis_v1" / "local-only.txt"
    assert not source.exists()


def test_attachment_is_copied_and_verified(tmp_path: Path) -> None:
    case = CaseCatalog(ROOT).load_cases()["image.input.ui_error"]
    with EnvironmentProvisioner(ROOT, tmp_path).prepare(case) as environment:
        assert len(environment.attachment_refs) == 1
        copied = environment.workspace / next(iter(environment.attachment_refs.values()))
        assert copied.is_file()
        assert copied.parent.name == "regression"


def test_safe_join_rejects_escape(tmp_path: Path) -> None:
    with pytest.raises(EnvironmentError):
        safe_join(tmp_path, "../escape")


def test_environment_prepares_digest_bound_knowledge_and_control_resources(tmp_path: Path) -> None:
    case = CaseCatalog(ROOT).load_cases()["knowledge.grounded"]
    with EnvironmentProvisioner(ROOT, tmp_path).prepare(case) as prepared:
        manifest = prepared.manifest
        assert manifest["knowledge_bases"][0]["knowledge_base_id"] == "regression.opendrsai-runtime"
        assert (prepared.workspace / manifest["knowledge_bases"][0]["reference"]).is_file()
        control = next(item for item in manifest["input_resources"] if item["resource_id"] == "regression-control")
        payload = json.loads(control["content"])
        assert payload["required_capabilities"] == ["knowledge_search"]
        assert payload["network"] == "disabled"
        assert payload["allowed_commands"] == []
