package ai.drsai.remote

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.PinnedModelRoute
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class PinnedModelRouteTest {
    @Test
    fun `route snapshot is deterministic and contains no credential`() {
        val route = PinnedModelRoute.create(
            "stable-model", "provider-1", "vendor/model", "https://api.example/v1/",
            "openai", 7, "api_key",
        )
        val copy = PinnedModelRoute.create(
            "stable-model", "provider-1", "vendor/model", "https://api.example/v1",
            "openai", 7, "api_key",
        )

        assertEquals(route.getString("sha256"), copy.getString("sha256"))
        assertEquals("https://api.example/v1", route.getString("base_url"))
        assertFalse(route.toString().contains("secret", ignoreCase = true))
        assertEquals(route.toString(), PinnedModelRoute.validate(route, "stable-model").toString())
    }

    @Test
    fun `route model and digest tampering fail closed`() {
        val route = PinnedModelRoute.create(
            "stable-model", "provider-1", "vendor/model", "https://api.example/v1",
            "anthropic", 2, "api_key",
        )
        listOf(
            route.copy().put("upstream_model_id", "other"),
            route.copy().put("sha256", "0".repeat(64)),
        ).forEach { tampered ->
            val error = runCatching { PinnedModelRoute.validate(tampered, "stable-model") }.exceptionOrNull() as ApiException
            assertEquals("model_route_snapshot_invalid", error.code)
            assertFalse(error.retryable)
        }
    }

    private fun org.json.JSONObject.copy() = org.json.JSONObject(toString())
}
