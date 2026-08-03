from __future__ import annotations

from drsai.config.credentials import credential_available, delete_credential, resolve_credential, store_credential
from drsai.config.credential_lifecycle import cleanup_orphaned_credentials, scan_orphaned_credentials
from drsai.config.loader import parse_user_config
from drsai.config.resolver import resolve_model_config


def test_credential_round_trip_and_delete(tmp_path) -> None:
    reference = store_credential("credential-secret", root=tmp_path)

    assert reference.startswith("drsai-credential:")
    assert resolve_credential(reference, root=tmp_path) == "credential-secret"
    credential_file = next(tmp_path.glob("*.bin"))
    assert b"credential-secret" not in credential_file.read_bytes()
    assert delete_credential(reference, root=tmp_path) is True
    assert resolve_credential(reference, root=tmp_path) is None


def test_corrupt_credential_is_reported_unavailable(tmp_path) -> None:
    reference = store_credential("credential-secret", root=tmp_path)
    credential_file = next(tmp_path.glob("*.bin"))
    credential_file.write_bytes(b"not-valid-encrypted-data")

    assert resolve_credential(reference, root=tmp_path) is None
    assert credential_available(reference, root=tmp_path) is False


def test_resolver_supports_credential_reference_without_exposing_it(monkeypatch) -> None:
    reference = "drsai-credential:00000000-0000-0000-0000-000000000001"
    config = parse_user_config({
        "model": "custom",
        "model_provider": "private",
        "model_providers": {
            "private": {
                "base_url": "https://provider.example/v1",
                "api_key_credential": reference,
            }
        },
    })

    resolved = resolve_model_config(
        config,
        credential_resolver=lambda value: "resolved-secret" if value == reference else None,
    )

    assert resolved.provider.api_key.reveal() == "resolved-secret"
    assert resolved.provider.api_key_source == "credential"
    assert "resolved-secret" not in repr(resolved)


def test_orphan_cleanup_never_deletes_current_or_last_good_references(tmp_path) -> None:
    root = tmp_path / "credentials"
    current_ref = store_credential("current", root=root)
    last_good_ref = store_credential("last-good", root=root)
    orphan_ref = store_credential("orphan", root=root)
    path = tmp_path / "config.toml"
    path.write_text(
        'model = "m"\nmodel_provider = "p"\n[model_providers.p]\n'
        f'base_url = "https://example.test/v1"\napi_key_credential = "{current_ref}"\n',
        encoding="utf-8",
    )
    path.with_suffix(".toml.last-good").write_text(
        'model = "m"\nmodel_provider = "p"\n[model_providers.p]\n'
        f'base_url = "https://example.test/v1"\napi_key_credential = "{last_good_ref}"\n',
        encoding="utf-8",
    )

    scanned = scan_orphaned_credentials(path=path, root=root)
    assert scanned["orphan_references"] == [orphan_ref]
    dry_run = cleanup_orphaned_credentials(path=path, root=root, dry_run=True)
    assert dry_run["deleted_count"] == 0
    assert resolve_credential(orphan_ref, root=root) == "orphan"

    cleaned = cleanup_orphaned_credentials(path=path, root=root, dry_run=False)
    assert cleaned["deleted_count"] == 1
    assert resolve_credential(orphan_ref, root=root) is None
    assert resolve_credential(current_ref, root=root) == "current"
    assert resolve_credential(last_good_ref, root=root) == "last-good"


def test_macos_keychain_store_sends_secret_via_stdin_not_process_arguments(monkeypatch) -> None:
    import drsai.config.credentials as credentials_module

    captured = {}
    def run(args, **kwargs):
        captured["args"] = args
        captured["input"] = kwargs.get("input")
        return type("Result", (), {"returncode": 0, "stdout": ""})()

    monkeypatch.setattr(credentials_module.sys, "platform", "darwin")
    monkeypatch.setattr(credentials_module.subprocess, "run", run)
    secret = "mac-keychain-secret"
    reference = credentials_module.store_credential(secret)
    assert reference.startswith("drsai-credential:")
    assert secret not in repr(captured["args"])
    assert captured["input"] == f"{secret}\n"
