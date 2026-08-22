package ai.drsai.remote

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.ModelToolChoiceProtocolAdapter
import org.json.JSONArray
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
    fun `OpenAI maps automatic modes and omits incompatible forced choice`() {
        assertEquals("auto", ModelToolChoiceProtocolAdapter.openAi(policy("auto")))
        assertEquals("none", ModelToolChoiceProtocolAdapter.openAi(policy("none")))
        assertNull(ModelToolChoiceProtocolAdapter.openAi(
            policy("required").put("matching_tools", JSONArray().put("web.search")),
        ))
        assertNull(ModelToolChoiceProtocolAdapter.openAi(policy("specified", "web.search")))
    }

    @Test
    fun `OpenAI forced choice constrains the model-visible tool surface`() {
        val tools = JSONArray()
            .put(wireTool("web.search"))
            .put(wireTool("get_current_time"))
            .put(wireTool("workspace.read"))
        val specified = ModelToolChoiceProtocolAdapter.constrainOpenAiTools(
            policy("specified", "web.search"), tools,
        )
        assertEquals(1, specified.length())
        assertEquals("web__dot__search", specified.getJSONObject(0).getJSONObject("function").getString("name"))

        val required = ModelToolChoiceProtocolAdapter.constrainOpenAiTools(
            policy("required").put("matching_tools", JSONArray().put("workspace.read").put("web.search")),
            tools,
        )
        assertEquals(2, required.length())
    }

    @Test
    fun `OAEP null specified tool remains absent for automatic modes`() {
        val automatic = policy("auto").put("specified_tool", JSONObject.NULL)
        val none = policy("none").put("specified_tool", JSONObject.NULL)

        assertEquals("auto", ModelToolChoiceProtocolAdapter.openAi(automatic))
        assertEquals("none", ModelToolChoiceProtocolAdapter.openAi(none))
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

    private fun wireTool(name: String) = JSONObject()
        .put("type", "function")
        .put("function", JSONObject().put("name", name.replace(".", "__dot__")))
}
