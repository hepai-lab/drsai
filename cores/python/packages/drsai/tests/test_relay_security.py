from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path

import pytest

from drsai.relay.registry import RelayRegistryError
from drsai.relay.security import RelayTicketIssuer, RuntimePermissionEnforcer, redact_credentials, redact_secrets


ROOT = Path(__file__).resolve().parents[5]


def ticket(issuer: RelayTicketIssuer, now: datetime | None = None) -> str:
    return issuer.issue(subject="alice", organization="ihep", runtime_id="rt-a", workspace_id="ws-a",
                        scopes={"files.read", "run.create"}, device_id="android-1", session_id="login-1", now=now)


def test_short_lived_ticket_binds_all_security_context_and_scope() -> None:
    issuer = RelayTicketIssuer(ttl_seconds=60)
    principal = issuer.verify(ticket(issuer), expected_runtime="rt-a", expected_workspace="ws-a", required_scope="files.read")
    assert (principal.subject, principal.organization, principal.device_id, principal.session_id) == ("alice", "ihep", "android-1", "login-1")
    assert principal.jti
    with pytest.raises(RelayRegistryError, match="resource scope"):
        issuer.verify(ticket(issuer), expected_runtime="rt-b", expected_workspace="ws-a", required_scope="files.read")


def test_ticket_expiry_revocation_and_clock_skew_have_explicit_errors() -> None:
    issuer = RelayTicketIssuer(ttl_seconds=60, clock_skew_seconds=5)
    old = ticket(issuer, datetime.now(UTC) - timedelta(seconds=70))
    with pytest.raises(RelayRegistryError) as expired:
        issuer.verify(old, expected_runtime="rt-a", expected_workspace="ws-a", required_scope="files.read")
    assert expired.value.code == "ticket_expired"
    active = ticket(issuer)
    issuer.revoke(active)
    with pytest.raises(RelayRegistryError) as revoked:
        issuer.verify(active, expected_runtime="rt-a", expected_workspace="ws-a", required_scope="files.read")
    assert revoked.value.code == "ticket_revoked"


def test_runtime_rechecks_permission_after_valid_relay_ticket() -> None:
    issuer = RelayTicketIssuer()
    principal = issuer.verify(ticket(issuer), expected_runtime="rt-a", expected_workspace="ws-a", required_scope="run.create")
    enforcer = RuntimePermissionEnforcer({("alice", "ws-a"): {"files.read"}})
    with pytest.raises(RelayRegistryError) as denied:
        enforcer.authorize(principal, "run.create")
    assert denied.value.code == "runtime_permission_denied"


def test_secret_redaction_covers_headers_codes_tokens_and_file_content() -> None:
    raw = "Authorization: Bearer-abc Cookie=session-x token=jwt secret=key code=once file_content=private"
    redacted = redact_secrets(raw)
    assert not any(secret in redacted for secret in ("Bearer-abc", "session-x", "jwt", "key", "once", "private"))
    assert redacted.count("[REDACTED]") == 6


def test_shared_secret_redaction_canaries() -> None:
    fixtures = json.loads(
        (ROOT / "cores/protocol/relay/secret-redaction-fixtures.json").read_text(encoding="utf-8")
    )
    for sample in fixtures["samples"]:
        redacted = redact_secrets(sample["input"])
        assert "[REDACTED]" in redacted
        for canary in sample["must_not_contain"]:
            assert canary not in redacted


def test_credential_redaction_preserves_provider_error_fields() -> None:
    raw = (
        'Error code: 400 - {"error":{"message":"unsupported field"}} '
        'access_token=private-token'
    )
    redacted = redact_credentials(raw)

    assert 'code: 400' in redacted
    assert '"message":"unsupported field"' in redacted
    assert 'access_token=[REDACTED]' in redacted
    assert 'private-token' not in redacted
