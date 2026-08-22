package ai.drsai.remote

import ai.drsai.remote.data.ChatDao
import ai.drsai.remote.data.MemoryEntity
import ai.drsai.remote.runtime.context.MemoryPrivacyPolicy
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import ai.drsai.remote.runtime.tools.ToolExecutionOutcome
import ai.drsai.remote.runtime.tools.defaultLocalToolRegistry
import ai.drsai.remote.workbench.model.RuntimeCapability
import java.lang.reflect.Proxy
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

class MemoryPolicyTest {
    @Test fun sensitiveMemoryContentIsDeniedByHostDefenseInDepth() {
        val policy = MemoryPrivacyPolicy()
        listOf(
            "Bearer abc.def", "api_key=secret", "password: hunter2",
            "病历：诊断结果为测试", "-----BEGIN PRIVATE KEY----- secret",
        ).forEach { assertFalse(it, policy.mayPersist("fact", it)) }
        assertFalse(policy.mayPersist("medical", "healthy"))
        assertTrue(policy.mayPersist("preference", "prefers concise answers"))
    }

    @Test fun memoryToolsRequireCapabilityAndUseOnlyCallingSubject() = runBlocking {
        val saved = mutableListOf<MemoryEntity>()
        val searchedSubjects = mutableListOf<String>()
        val dao = Proxy.newProxyInstance(ChatDao::class.java.classLoader, arrayOf(ChatDao::class.java)) { _, method, args ->
            when (method.name) {
                "saveMemory" -> { saved += args!![0] as MemoryEntity; 73L }
                "searchMemories" -> { searchedSubjects += args!![0] as String; emptyList<MemoryEntity>() }
                else -> null
            }
        } as ChatDao
        val registry = defaultLocalToolRegistry(dao)
        val disabled = ToolExecutionContext("alice", emptySet())
        assertFalse(registry.definitions(disabled).any { it.id in setOf("save_memory", "search_memory") })

        val alice = ToolExecutionContext("alice", setOf(RuntimeCapability.LOCAL_MEMORY))
        assertTrue(registry.definitions(alice).any { it.id == "save_memory" })
        val savedResult = registry.execute(alice, "save_memory", """{"content":"prefers concise answers","label":"preference"}""")
        assertTrue(savedResult is ToolExecutionOutcome.Success)
        assertEquals("alice", saved.single().userId)

        registry.execute(alice, "search_memory", """{"query":"concise"}""")
        assertEquals(listOf("alice"), searchedSubjects)
        val rejected = registry.execute(alice, "save_memory", """{"content":"api_key=secret"}""")
        assertEquals("memory_sensitive_content_denied", (rejected as ToolExecutionOutcome.Rejected).code)
    }

    @Test fun memorySearchReturnsGroundedSourcesForEmptySingleAndConflictingResults() = runBlocking {
        var rows = emptyList<MemoryEntity>()
        val dao = Proxy.newProxyInstance(ChatDao::class.java.classLoader, arrayOf(ChatDao::class.java)) { _, method, _ ->
            when (method.name) {
                "searchMemories" -> rows
                else -> null
            }
        } as ChatDao
        val registry = defaultLocalToolRegistry(dao)
        val context = ToolExecutionContext("alice", setOf(RuntimeCapability.LOCAL_MEMORY))

        suspend fun search(): JSONObject {
            val outcome = registry.execute(context, "search_memory", """{"query":"answer style"}""")
            return JSONObject((outcome as ToolExecutionOutcome.Success).output)
        }

        assertEquals(0, search().getInt("result_count"))
        rows = listOf(MemoryEntity(id = 7, userId = "alice", content = "Use concise answers"))
        val single = search()
        assertEquals("memory:7", single.getJSONArray("items").getJSONObject(0).getString("source_id"))
        assertEquals("[memory:7]", single.getJSONArray("items").getJSONObject(0).getString("citation"))
        rows = listOf(
            MemoryEntity(id = 8, userId = "alice", content = "Use detailed answers"),
            MemoryEntity(id = 7, userId = "alice", content = "Use concise answers"),
        )
        val conflicting = search()
        assertEquals(2, conflicting.getInt("result_count"))
        assertEquals(
            listOf("memory:8", "memory:7"),
            (0 until conflicting.getJSONArray("items").length()).map {
                conflicting.getJSONArray("items").getJSONObject(it).getString("source_id")
            },
        )
        assertEquals("returned_content_only_preserve_conflicts_cite_sources", conflicting.getString("answer_policy"))
    }
}
