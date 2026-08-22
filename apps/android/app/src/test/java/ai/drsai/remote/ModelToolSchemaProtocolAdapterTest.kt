package ai.drsai.remote

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.ModelToolSchemaProtocolAdapter
import ai.drsai.remote.runtime.python.ModelRuntimeCapabilities
import ai.drsai.remote.runtime.tools.FullRuntimeToolCatalog
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelToolSchemaProtocolAdapterTest {
    private val parameters = JSONObject()
        .put("type", "object")
        .put("properties", JSONObject()
            .put("查询", JSONObject().put("type", "string").put("enum", JSONArray().put("安卓").put("桌面")))
            .put("filters", JSONObject().put("type", "object").put("properties", JSONObject()
                .put("years", JSONObject().put("type", "array").put("items", JSONObject().put("type", "integer"))))
                .put("required", JSONArray().put("years"))))
        .put("required", JSONArray().put("查询"))
        .put("additionalProperties", false)

    private val canonical = JSONArray().put(JSONObject()
        .put("name", "web.search")
        .put("description", "检索中文与 Unicode ✓")
        .put("parameters", parameters))

    @Test
    fun `OpenAI adapter preserves Unicode enum nested object and array semantics`() {
        val adapted = ModelToolSchemaProtocolAdapter.adapt(
            ModelRuntimeCapabilities("gpt", "openai", true, false, false, "configured"), canonical,
        ).getJSONObject(0)

        assertEquals("function", adapted.getString("type"))
        val function = adapted.getJSONObject("function")
        assertEquals("web__dot__search", function.getString("name"))
        assertEquals("检索中文与 Unicode ✓", function.getString("description"))
        assertEquals(parameters.toString(), function.getJSONObject("parameters").toString())
        assertFalse(function.getJSONObject("parameters").getBoolean("additionalProperties"))
    }

    @Test
    fun `Anthropic adapter maps parameters only to input_schema without semantic loss`() {
        val adapted = ModelToolSchemaProtocolAdapter.adapt(
            ModelRuntimeCapabilities("claude", "anthropic", true, false, true, "provider_metadata"), canonical,
        ).getJSONObject(0)

        assertEquals("web__dot__search", adapted.getString("name"))
        assertTrue(adapted.has("input_schema"))
        assertFalse(adapted.has("parameters"))
        assertEquals(parameters.toString(), adapted.getJSONObject("input_schema").toString())
    }

    @Test
    fun `wrapped OpenAI function input is canonicalized exactly once`() {
        val wrapped = JSONArray().put(JSONObject().put("type", "function").put("function", canonical.getJSONObject(0)))
        val adapted = ModelToolSchemaProtocolAdapter.openAi(wrapped)

        assertEquals("web__dot__search", adapted.getJSONObject(0).getJSONObject("function").getString("name"))
        assertFalse(adapted.toString().contains("function\":{\"type\":\"function"))
    }

    @Test
    fun `malformed schemas fail before provider with stable compatibility code`() {
        val missingName = JSONArray().put(JSONObject().put("parameters", parameters))
        val unknownRequired = JSONArray().put(JSONObject().put("name", "bad").put("parameters",
            JSONObject().put("type", "object").put("properties", JSONObject())
                .put("required", JSONArray().put("missing"))))

        listOf(missingName, unknownRequired).forEach { schemas ->
            val error = runCatching { ModelToolSchemaProtocolAdapter.openAi(schemas) }.exceptionOrNull() as ApiException
            assertEquals(422, error.status)
            assertEquals("model_tool_schema_invalid", error.code)
            assertFalse(error.retryable)
        }
    }

    @Test
    fun `complete Full Runtime core catalog adapts to both provider protocols`() {
        val catalog = FullRuntimeToolCatalog.schemas(JSONArray())

        val openAi = ModelToolSchemaProtocolAdapter.openAi(catalog)
        val anthropic = ModelToolSchemaProtocolAdapter.anthropic(catalog)

        assertTrue(catalog.length() > 0)
        assertEquals(catalog.length(), openAi.length())
        assertEquals(catalog.length(), anthropic.length())
        assertTrue((0 until openAi.length()).all {
            openAi.getJSONObject(it).getJSONObject("function").getJSONObject("parameters").getString("type") == "object"
        })
        assertTrue((0 until anthropic.length()).all {
            anthropic.getJSONObject(it).getJSONObject("input_schema").getString("type") == "object"
        })
    }
}
