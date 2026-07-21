from __future__ import annotations

from drsai.relay.idempotency import IdempotencyLedger, RequestOutcome


def test_create_is_executed_once_and_result_is_queryable() -> None:
    ledger, calls = IdempotencyLedger(), []
    arguments = dict(subject="alice", operation="session.create", idempotency_key="idem-0001",
                     request_id="request-1", correlation_id="correlation-1")
    first = ledger.execute(**arguments, action=lambda: calls.append(1) or {"session_id": "s1"})
    second = ledger.execute(**arguments, action=lambda: calls.append(2))
    assert first == second == ledger.query("alice", "session.create", "idem-0001")
    assert first.outcome == RequestOutcome.SUCCEEDED and calls == [1]


def test_transport_timeout_is_unknown_not_runtime_failure_and_can_be_queried() -> None:
    ledger = IdempotencyLedger()

    def timeout():
        raise TimeoutError("runtime response was not observed")

    record = ledger.execute(subject="alice", operation="run.create", idempotency_key="idem-0002",
                            request_id="request-2", correlation_id="correlation-2", action=timeout)
    assert record.outcome == RequestOutcome.UNKNOWN
    assert record.error_code is None
    assert ledger.query("alice", "run.create", "idem-0002") == record
