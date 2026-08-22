package ai.drsai.remote

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.FullRuntimeDiagnosticUi
import ai.drsai.remote.data.ModelInfo
import ai.drsai.remote.runtime.python.ModelRuntimeCapabilities
import ai.drsai.remote.runtime.python.requireRunSupport
import ai.drsai.remote.runtime.python.requireToolCallBatch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelRuntimeCapabilitiesTest {
    @Test
    fun `OpenAI and Anthropic configured fixtures preserve authoritative capabilities`() {
        val openAi = ModelRuntimeCapabilities.configured(
            ModelInfo("gpt-tools", tools = true, reasoning = false), "openai",
        )
        val anthropic = ModelRuntimeCapabilities.configured(
            ModelInfo("claude-reasoning", tools = true, reasoning = true), "anthropic",
        )

        assertEquals("openai", openAi.wireApi)
        assertTrue(openAi.tools)
        assertEquals("anthropic", anthropic.wireApi)
        assertTrue(anthropic.reasoning)
        openAi.requireRunSupport(12)
        anthropic.requireRunSupport(12)
        assertNotEquals(openAi.digest, anthropic.digest)
    }

    @Test
    fun `no-tools and unknown discovery fixtures fail closed before Run`() {
        val noTools = ModelRuntimeCapabilities.configured(ModelInfo("chat-only"), "openai")
        val noToolsError = runCatching { noTools.requireRunSupport(1) }.exceptionOrNull() as ApiException
        assertEquals("model_tools_unsupported", noToolsError.code)

        val unknown = ModelRuntimeCapabilities.configured(
            ModelInfo("discovered", source = "DISCOVERED"), "anthropic",
        )
        val unknownError = runCatching { unknown.requireRunSupport(1) }.exceptionOrNull() as ApiException
        assertEquals("model_capabilities_unknown", unknownError.code)
        assertEquals("provider_metadata", unknown.source)
    }

    @Test
    fun `parallel tool fixture requires an explicit positive capability`() {
        val serial = ModelRuntimeCapabilities("serial", "openai", true, false, false, "probe")
        val parallel = ModelRuntimeCapabilities("parallel", "openai", true, true, true, "probe")

        val error = runCatching { serial.requireToolCallBatch(2) }.exceptionOrNull() as ApiException
        assertEquals("model_parallel_tools_unsupported", error.code)
        parallel.requireToolCallBatch(2)
    }

    @Test
    fun `capability digest and reasoning status are diagnosable`() {
        val profile = ModelRuntimeCapabilities("reasoner", "anthropic", true, false, true, "configured")
        val text = FullRuntimeDiagnosticUi(
            modelCapabilityStatus = profile.status,
            modelCapabilitySource = profile.source,
            modelCapabilityDigest = profile.digest,
            modelSupportsTools = profile.tools,
            modelSupportsParallelTools = profile.parallelTools,
            modelSupportsReasoning = profile.reasoning,
        ).exportText()

        assertTrue(text.contains("model_capability_status=known"))
        assertTrue(text.contains("model_capability_source=configured"))
        assertTrue(text.contains("model_capability_digest=${profile.digest}"))
        assertTrue(text.contains("model_supports_reasoning=true"))
        assertEquals(profile.digest, profile.copy().digest)
    }
}
