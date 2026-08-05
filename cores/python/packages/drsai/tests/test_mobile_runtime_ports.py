import asyncio

from drsai.backend.runtime.mobile_core import (
    ApprovalDecision,
    ApprovalRequest,
    CheckpointRecord,
    ModelChunk,
    ModelRequest,
    ToolCall,
    ToolResult,
)


def test_port_values_contain_only_sanitized_bridge_data() -> None:
    request = ModelRequest(
        request_id="request-1",
        model_id="model-capability-id",
        messages=({"role": "user", "content": "hello"},),
    )
    tool = ToolCall("call-1", "read_artifact", {"artifact_id": "opaque-1"}, "tool:call-1")
    result = ToolResult("call-1", True, {"text": "ok"}, artifact_ids=("opaque-2",))
    approval = ApprovalRequest("approval-1", "call-1", "high", "保存文件", "写入授权工作区")
    checkpoint = CheckpointRecord("run-1", 2, {"phase": "waiting_approval"})

    values = repr((request, tool, result, approval, checkpoint))
    assert "token" not in values.lower()
    assert "content://" not in values
    assert "keystore" not in values.lower()


def test_port_result_types_support_async_host_adapters() -> None:
    class FakeToolHost:
        async def execute(self, call: ToolCall) -> ToolResult:
            return ToolResult(call.call_id, True, {"echo": call.arguments["value"]})

    class FakeApprovalHost:
        async def request(self, request: ApprovalRequest) -> ApprovalDecision:
            return ApprovalDecision(request.approval_id, "approved")

    async def exercise() -> None:
        result = await FakeToolHost().execute(ToolCall("c", "echo", {"value": 3}, "key"))
        decision = await FakeApprovalHost().request(
            ApprovalRequest("a", "c", "low", "Echo", "Return a value")
        )
        assert result.content == {"echo": 3}
        assert decision.decision == "approved"

    asyncio.run(exercise())


def test_model_chunks_are_stream_transport_neutral() -> None:
    chunks = [ModelChunk("request-1", "hel"), ModelChunk("request-1", "lo", "stop")]
    assert "".join(chunk.delta for chunk in chunks) == "hello"
