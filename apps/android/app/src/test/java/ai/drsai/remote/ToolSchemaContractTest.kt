package ai.drsai.remote

import ai.drsai.remote.data.ChatDao
import ai.drsai.remote.runtime.tools.FullRuntimeToolCatalog
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import ai.drsai.remote.runtime.tools.defaultLocalToolRegistry
import ai.drsai.remote.workbench.model.RuntimeCapability
import java.io.File
import java.lang.reflect.Proxy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ToolSchemaContractTest {
    @Test fun registryDefinitionsAreTheExactModelSchemaSource() {
        val dao = Proxy.newProxyInstance(ChatDao::class.java.classLoader, arrayOf(ChatDao::class.java)) { _, _, _ -> null } as ChatDao
        val registry = defaultLocalToolRegistry(dao)
        val context = ToolExecutionContext("alice", setOf(RuntimeCapability.LOCAL_MEMORY, RuntimeCapability.WEB_SEARCH, RuntimeCapability.WEB_FETCH))
        val definitions = registry.definitions(context)
        val modelSchemas = registry.toModelSchemas(context)

        assertEquals(definitions.map { it.id }, (0 until modelSchemas.length()).map { modelSchemas.getJSONObject(it).getString("name") })
        definitions.forEachIndexed { index, definition ->
            val schema = modelSchemas.getJSONObject(index)
            assertEquals(definition.toRuntimeSchema().toString(), schema.toString())
            assertEquals(definition.version, schema.getInt("version"))
            assertEquals("android-host", schema.getString("source"))
            assertEquals("local-equivalent", schema.getString("classification"))
            assertEquals(definition.risk.name.lowercase(), schema.getString("risk"))
            val required = schema.getJSONObject("parameters").optJSONArray("required")
            assertEquals(definition.requiredArguments.sorted(), required?.let { array ->
                (0 until array.length()).map(array::getString).sorted()
            }.orEmpty())
        }
        val complete = FullRuntimeToolCatalog.schemas(modelSchemas)
        val names = (0 until complete.length()).map { complete.getJSONObject(it).getString("name") }
        assertTrue(names.containsAll(listOf("get_current_time", "save_memory", "search_memory", "web.search", "web.fetch", "core.text_stats", "core.data_compute", "core.update_plan", "delegate")))
        val compute = complete.getJSONObject(names.indexOf("core.data_compute")).getJSONObject("parameters")
        assertEquals(10_000, compute.getJSONObject("properties").getJSONObject("values").getInt("maxItems"))
        assertFalse(compute.toString().contains("code"))
        assertFalse(compute.toString().contains("path"))
        assertFalse(compute.toString().contains("url"))
        (0 until complete.length()).forEach { index ->
            val schema = complete.getJSONObject(index)
            assertTrue(schema.getInt("version") > 0)
            assertTrue(schema.getString("source") in setOf("android-host", "shared-core"))
            assertTrue(schema.getString("classification") in setOf("local-equivalent", "shared"))
            assertTrue(schema.has("required_capabilities"))
        }
    }

    @Test fun modelClientAndAppViewModelContainNoDuplicateHostToolSchemaCatalog() {
        val modelSource = source("src/main/java/ai/drsai/remote/data/HaiModelClient.kt")
        val appSource = source("src/main/java/ai/drsai/remote/AppViewModel.kt")
        listOf("get_current_time", "get_device_info", "save_memory", "search_memory", "web.search", "web.fetch", "workspace.read", "workspace.write").forEach {
            assertFalse("duplicate model schema for $it", modelSource.contains("\"$it\""))
        }
        assertTrue(appSource.contains("FullRuntimeToolCatalog.schemas(localTools.modelSchemas(subject))"))
        assertFalse(appSource.contains("skillCatalog.pin(request.runId, emptySet())"))
        assertTrue(appSource.contains("fullLocalRuntimeCapabilities(request.accountSubject)"))
    }

    private fun source(relative: String): String {
        val candidates = listOf(File(relative), File("app/$relative"), File("apps/android/app/$relative"))
        return candidates.firstOrNull(File::isFile)?.readText() ?: error("source_not_found:$relative")
    }
}
