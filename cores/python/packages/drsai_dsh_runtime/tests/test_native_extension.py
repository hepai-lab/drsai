from __future__ import annotations

import hashlib

import pytest

from opendrsai_dsh_runtime.native_extension import (
    DSH_RC5_COMMIT,
    NativeExtensionBundle,
    NativeExtensionError,
)


def carrier_tree(root):
    root.mkdir()
    (root / "package.json").write_text("{}", encoding="utf-8")
    for name in (
        "@deepseek-ai/dsh-sdk-protocol", "@deepseek-ai/dsh-agent",
        "@deepseek-ai/dsh-sandbox-local", "@deepseek-ai/dsh-fs-sandbox",
    ):
        root.joinpath("node_modules", *name.split("/")).mkdir(parents=True)
    return root


def test_rc5_extension_stages_deterministically_and_is_idempotent(tmp_path) -> None:
    bundle = NativeExtensionBundle.rc5()
    root = carrier_tree(tmp_path / "carrier")
    first = bundle.stage(root, source_commit=DSH_RC5_COMMIT)
    second = bundle.stage(root, source_commit=DSH_RC5_COMMIT)
    assert first == second
    assert first["contract_sha256"] == bundle.contract_sha256
    assert len(bundle.contract_sha256) == 64
    for relative, expected in bundle.files.items():
        assert hashlib.sha256(root.joinpath(*relative.split("/")).read_bytes()).digest() == hashlib.sha256(expected).digest()
    config = bundle.materialize_config(tmp_path / "state" / "cordis.yml")
    assert config.read_bytes() == bundle.files["opendrsai.cordis.yml"]


def test_rc5_extension_rejects_commit_or_dependency_drift(tmp_path) -> None:
    bundle = NativeExtensionBundle.rc5()
    root = carrier_tree(tmp_path / "carrier")
    with pytest.raises(NativeExtensionError, match="commit"):
        bundle.stage(root, source_commit="0" * 40)
    (root / "node_modules/@deepseek-ai/dsh-agent").rmdir()
    with pytest.raises(NativeExtensionError, match="closure"):
        bundle.stage(root, source_commit=DSH_RC5_COMMIT)
