package ai.drsai.remote

import ai.drsai.remote.runtime.errors.*
import org.junit.Assert.*
import org.junit.Test

class UserFacingFailureTest {
    @Test fun `all eleven failure categories have stable actionable presentations`() {
        val signals = listOf(
            FailureSignal(code = "configuration_invalid") to FailureCategory.CONFIGURATION,
            FailureSignal(code = "model_provider_credentials_missing", status = 401) to FailureCategory.CREDENTIAL,
            FailureSignal(code = "quota_exceeded", status = 429, retryable = true) to FailureCategory.QUOTA_OR_RATE_LIMIT,
            FailureSignal(code = "provider_timeout", status = 408, retryable = true) to FailureCategory.NETWORK,
            FailureSignal(code = "model_tools_unsupported") to FailureCategory.MODEL_CAPABILITY,
            FailureSignal(code = "python_runtime_unavailable", source = "runtime") to FailureCategory.RUNTIME,
            FailureSignal(code = "saf_permission_required") to FailureCategory.PERMISSION,
            FailureSignal(code = "tool_execution_failed", source = "tool") to FailureCategory.TOOL,
            FailureSignal(code = "approval_required") to FailureCategory.APPROVAL,
            FailureSignal(code = "checkpoint_recovery_required") to FailureCategory.RECOVERY,
            FailureSignal(code = "desktop_required") to FailureCategory.PLATFORM_UNSUPPORTED,
        )
        assertEquals(FailureCategory.entries.toSet(), signals.map { it.second }.toSet())
        signals.forEach { (signal, expected) ->
            val result = UserFacingFailureMapper.map(signal)
            assertEquals(expected, result.category)
            assertTrue(result.title.isNotBlank())
            assertTrue(result.summary.isNotBlank())
            assertNotEquals(FailureAction.NONE, result.primaryAction)
            assertTrue(result.stableCode.isNotBlank())
        }
    }

    @Test fun `provider status codes map to credential quota and network instead of runtime`() {
        assertEquals(FailureCategory.CREDENTIAL, UserFacingFailureMapper.map(FailureSignal(status = 401, source = "provider")).category)
        assertEquals(FailureCategory.QUOTA_OR_RATE_LIMIT, UserFacingFailureMapper.map(FailureSignal(status = 402, source = "provider")).category)
        assertEquals(FailureCategory.QUOTA_OR_RATE_LIMIT, UserFacingFailureMapper.map(FailureSignal(status = 429, source = "provider")).category)
        assertEquals(FailureCategory.NETWORK, UserFacingFailureMapper.map(FailureSignal(status = 408, source = "provider")).category)
        assertEquals(FailureCategory.NETWORK, UserFacingFailureMapper.map(FailureSignal(code = "provider_dns_failed", source = "provider")).category)
        assertEquals(FailureCategory.NETWORK, UserFacingFailureMapper.map(FailureSignal(code = "provider_tls_failed", source = "provider")).category)
    }

    @Test fun `technical detail is bounded and redacts credentials`() {
        val result = UserFacingFailureMapper.map(FailureSignal(
            code = "provider_error",
            detail = "Authorization: Bearer secret-token API_KEY=also-secret " + "x".repeat(800),
        ))
        assertFalse(result.technicalDetail.orEmpty().contains("secret-token"))
        assertFalse(result.technicalDetail.orEmpty().contains("also-secret"))
        assertTrue(result.technicalDetail.orEmpty().length <= 512)
    }

    @Test fun `credential permission and model capability are never blind retry`() {
        listOf("credential_missing", "saf_permission_required", "model_tools_unsupported").forEach { code ->
            assertFalse(UserFacingFailureMapper.map(FailureSignal(code = code, retryable = true)).retryable)
        }
    }

    @Test fun `provider actionable fixtures preserve real attribution and redact response bodies`() {
        data class Fixture(
            val status: Int?, val code: String, val action: FailureAction, val titlePart: String, val retryable: Boolean,
        )
        val fixtures = listOf(
            Fixture(401, "provider_credentials_invalid", FailureAction.UPDATE_CREDENTIAL, "credential", false),
            Fixture(403, "provider_permission_denied", FailureAction.CHECK_PROVIDER_ACCESS, "access", false),
            Fixture(402, "provider_payment_required", FailureAction.CHECK_PROVIDER_ACCOUNT, "balance", false),
            Fixture(408, "provider_timeout", FailureAction.CHECK_NETWORK, "timed out", true),
            Fixture(429, "provider_rate_limit", FailureAction.RETRY_LATER, "frequent", true),
            Fixture(503, "provider_unavailable", FailureAction.RETRY_LATER, "Model service", true),
            Fixture(null, "provider_stream_interrupted", FailureAction.RETRY_LATER, "interrupted", true),
        )
        fixtures.forEach { fixture ->
            val failure = UserFacingFailureMapper.map(FailureSignal(
                code = fixture.code,
                status = fixture.status,
                source = "provider",
                retryable = fixture.retryable,
                detail = "upstream body: real provider message; Authorization: Bearer secret; api_key=sk-secret-secret",
            ))
            assertEquals(fixture.action, failure.primaryAction)
            assertTrue(failure.title.contains(fixture.titlePart))
            assertEquals(fixture.retryable, failure.retryable)
            assertFalse(failure.technicalDetail.orEmpty().contains("secret"))
            assertTrue(failure.technicalDetail.orEmpty().contains("real provider message"))
            assertFalse(failure.summary.contains("Runtime"))
        }
    }
}
