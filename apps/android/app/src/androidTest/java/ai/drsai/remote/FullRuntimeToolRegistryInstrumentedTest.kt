package ai.drsai.remote

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.runtime.device.SafeDeviceInfoProvider
import ai.drsai.remote.runtime.device.SafWorkspaceGateway
import ai.drsai.remote.runtime.device.SafWorkspaceStore
import ai.drsai.remote.runtime.device.registerAndroidDeviceTools
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import ai.drsai.remote.runtime.tools.ToolExecutionOutcome
import ai.drsai.remote.runtime.tools.defaultLocalToolRegistry
import ai.drsai.remote.workbench.model.RuntimeCapability
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FullRuntimeToolRegistryInstrumentedTest {
    private lateinit var database: ChatDatabase
    private lateinit var context: Context

    @Before fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        database = Room.inMemoryDatabaseBuilder(context, ChatDatabase::class.java).allowMainThreadQueries().build()
    }

    @After fun tearDown() = database.close()

    @Test fun baseToolsExistWithoutSafAndWorkspaceToolsFollowCapabilities() {
        val registry = registry()
        val base = registry.definitions(ToolExecutionContext("alice", setOf(
            RuntimeCapability.LOCAL_MEMORY, RuntimeCapability.SAFE_DEVICE_INFO,
        ))).map { it.id }.toSet()
        assertTrue(base.containsAll(setOf("get_current_time", "get_device_info", "save_memory", "search_memory")))
        assertFalse(base.any { it.startsWith("workspace.") })

        val granted = registry.definitions(ToolExecutionContext("alice", setOf(
            RuntimeCapability.LOCAL_MEMORY, RuntimeCapability.SAFE_DEVICE_INFO,
            RuntimeCapability.SAF_READ, RuntimeCapability.SAF_WRITE,
        ))).map { it.id }.toSet()
        assertTrue(granted.containsAll(setOf("workspace.list", "workspace.read", "workspace.search", "workspace.write")))
        val write = registry.toModelSchemas(ToolExecutionContext("alice", setOf(RuntimeCapability.SAF_WRITE)))
        val schema = (0 until write.length()).map(write::getJSONObject).single { it.getString("name") == "workspace.write" }
        assertTrue(schema.getBoolean("requires_approval"))
        assertTrue(schema.getJSONObject("parameters").getJSONArray("required").length() == 2)
    }

    @Test fun baseToolsExecuteThroughTheSameRegistryWithoutSafPermission() = runBlocking {
        val registry = registry()
        val execution = ToolExecutionContext("alice", setOf(
            RuntimeCapability.LOCAL_MEMORY,
            RuntimeCapability.SAFE_DEVICE_INFO,
        ))
        assertTrue(registry.execute(execution, "get_current_time", "{}") is ToolExecutionOutcome.Success)
        assertTrue(registry.execute(execution, "get_device_info", "{}") is ToolExecutionOutcome.Success)
        assertTrue(
            registry.execute(execution, "save_memory", "{\"content\":\"dark theme\"}")
                is ToolExecutionOutcome.Success,
        )
        val search = registry.execute(execution, "search_memory", "{\"query\":\"dark\"}")
        assertTrue(search is ToolExecutionOutcome.Success && "dark theme" in search.output)
    }

    @Test fun forgedSafCapabilityStillFailsClosedWithoutPersistedGrant() = runBlocking {
        val registry = registry()
        val outcome = registry.execute(
            ToolExecutionContext("alice", setOf(RuntimeCapability.SAF_READ)),
            "workspace.list", "{}",
        )
        assertTrue(outcome is ToolExecutionOutcome.Rejected)
        assertTrue(
            registry.execute(ToolExecutionContext("alice", emptySet()), "unknown.tool", "{}")
                is ToolExecutionOutcome.Rejected,
        )
        assertTrue(
            registry.execute(ToolExecutionContext("alice", setOf(RuntimeCapability.LOCAL_MEMORY)), "save_memory", "not-json")
                is ToolExecutionOutcome.Rejected,
        )
        assertTrue(
            registry.execute(ToolExecutionContext("alice", setOf(RuntimeCapability.LOCAL_MEMORY)), "save_memory", "{}")
                is ToolExecutionOutcome.Rejected,
        )
    }

    private fun registry() = defaultLocalToolRegistry(database.dao()).also { registry ->
        registerAndroidDeviceTools(
            registry,
            SafeDeviceInfoProvider(context),
            SafWorkspaceGateway(context, SafWorkspaceStore(context)),
        )
    }
}
