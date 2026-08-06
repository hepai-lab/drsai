package ai.drsai.remote

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.ModelToolChoiceProtocolAdapter
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class ModelToolChoiceProtocolAdapterTest {
    private fun policy(mode: String, specified: String? = null) = JSONObject()
        .put("policy_version", "p9-tool-choice-v1")
        .put("mode", mode)
        .apply { if (specified != null) put("specified_tool", specified) }

    @Test
    fun `OpenAI maps auto required none and specified tool`() {
        assertEquals("auto", ModelToolChoiceProtocolAdapter.openAi(policy("auto")))
        assertEquals("required", ModelToolChoiceProtocolAdapter.openAi(policy("required")))
        assertEquals("none", ModelToolChoiceProtocolAdapter.openAi(policy("none")))
        val specified = ModelToolChoiceProtocolAdapter.openAi(policy("specified", "web.search")) as JSONObject
        assertEquals("web__dot__search", specified.getJSONObject("function").getString("name"))
    }

    @Test
    fun `Anthropic maps auto any omitted tools and named tool`() {
        assertEquals("auto", ModelToolChoiceProtocolAdapter.anthropic(policy("auto"))!!.getString("type"))
        assertEquals("any", ModelToolChoiceProtocolAdapter.anthropic(policy("required"))!!.getString("type"))
        assertNull(ModelToolChoiceProtocolAdapter.anthropic(policy("none")))
        val specified = ModelToolChoiceProtocolAdapter.anthropic(policy("specified", "workspace.read"))!!
        assertEquals("tool", specified.getString("type"))
        assertEquals("workspace__dot__read", specified.getString("name"))
    }

    @Test
    fun `invalid tool choice policy fails closed`() {
        listOf(
            JSONObject().put("policy_version", "old").put("mode", "auto"),
            policy("specified"),
            policy("none", "web.search"),
        ).forEach { invalid ->
            val error = runCatching { ModelToolChoiceProtocolAdapter.openAi(invalid) }.exceptionOrNull() as ApiException
            assertEquals("model_tool_choice_invalid", error.code)
            assertFalse(error.retryable)
        }
    }
}
