package ai.drsai.remote

import ai.drsai.remote.remote.generated.GeneratedApprovalDecisionRecoveryResponse
import ai.drsai.remote.remote.generated.GeneratedLatencyObservationRequest
import ai.drsai.remote.remote.generated.GeneratedRunCreateRequest
import ai.drsai.remote.remote.generated.GeneratedSessionUpdateRequest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GeneratedRelayWriteContractTest {
    private fun runRequestJson() = GeneratedRunCreateRequest(
        requestId = "550e8400-e29b-41d4-a716-446655440000",
        correlationId = "corr-1",
        idempotencyKey = "idem-key",
        message = "hello",
        sourceMessageId = "source-1",
        attachmentRefs = listOf("attachment-1"),
    ).toJson()

    @Test
    fun `generated request round trips exact wire names`() {
        val decoded = GeneratedRunCreateRequest.fromJson(runRequestJson())
        assertEquals("corr-1", decoded.correlationId)
        assertEquals(listOf("attachment-1"), decoded.attachmentRefs)
        assertEquals("source-1", decoded.sourceMessageId)
    }

    @Test
    fun `generated request rejects unknown missing and wrong type fields`() {
        assertTrue(runCatching {
            GeneratedRunCreateRequest.fromJson(runRequestJson().put("unknown", true))
        }.isFailure)
        assertTrue(runCatching {
            GeneratedRunCreateRequest.fromJson(runRequestJson().apply { remove("message") })
        }.isFailure)
        assertTrue(runCatching {
            GeneratedRunCreateRequest.fromJson(runRequestJson().put("message", 42))
        }.isFailure)
        assertTrue(runCatching {
            GeneratedLatencyObservationRequest.fromJson(JSONObject()
                .put("client_receive_at_ms", "1")
                .put("render_at_ms", 2))
        }.isFailure)
    }

    @Test
    fun `optional request fields preserve canonical defaults and alternatives`() {
        val decoded = GeneratedRunCreateRequest.fromJson(JSONObject()
            .put("request_id", "550e8400-e29b-41d4-a716-446655440000")
            .put("correlation_id", "corr-2")
            .put("idempotency_key", "idem-key")
            .put("message", "hello"))
        assertTrue(decoded.attachmentRefs.isEmpty())
        assertEquals(null, decoded.sourceMessageId)
        assertEquals("renamed", GeneratedSessionUpdateRequest(
            requestId = "550e8400-e29b-41d4-a716-446655440000",
            correlationId = "corr-3",
            title = "renamed",
        ).title)
    }

    @Test
    fun `approval recovery uses production minimal projection and rejects leaks`() {
        val value = JSONObject()
            .put("status", "succeeded")
            .put("operation", "approval.decide")
            .put("resource", JSONObject()
                .put("runtime_id", "runtime-1")
                .put("approval_id", "approval-1")
                .put("status", "approved"))
        assertEquals(
            "approved",
            GeneratedApprovalDecisionRecoveryResponse.fromJson(value).resource.status,
        )
        value.getJSONObject("resource").put("workspace_id", "must-not-leak")
        assertTrue(runCatching {
            GeneratedApprovalDecisionRecoveryResponse.fromJson(value)
        }.isFailure)
    }
}
