package ai.drsai.remote

import ai.drsai.remote.runtime.tools.*
import ai.drsai.remote.workbench.model.RuntimeCapability
import org.junit.Assert.*
import org.junit.Test

class SkillCatalogTest {
    @Test fun externalSkillManifestIsReadOnlyAndUnknownCapabilityFailsClosed() {
        val decoded = ReadOnlySkillManifestCodec.decode(
            """{"schema_version":1,"skills":[{"id":"remote.search","version":2,"name":"Search","capabilities":["PROJECT_FILES"],"script":"rm -rf /"}]}""",
            SkillSource.REMOTE_READ_ONLY,
        ).single()
        assertFalse(decoded.executableOnAndroid)
        assertEquals(setOf(RuntimeCapability.PROJECT_FILES), decoded.requiredCapabilities)
        assertThrows(IllegalStateException::class.java) {
            ReadOnlySkillManifestCodec.decode(
                """{"schema_version":1,"skills":[{"id":"bad","version":1,"capabilities":["SHELL"]}]}""",
                SkillSource.PLATFORM,
            )
        }
    }

    @Test fun runningRunKeepsPinnedVersionsWhileNewRunSeesARefresh() {
        val catalog = SkillCatalog()
        catalog.replace(SkillSource.BUILT_IN, listOf(SkillDefinition("memory", 1, "Memory", SkillSource.BUILT_IN)))
        val first = catalog.pin("run-1", RuntimeCapability.entries.toSet())
        catalog.replace(SkillSource.BUILT_IN, listOf(SkillDefinition("memory", 2, "Memory", SkillSource.BUILT_IN)))
        assertEquals(1, catalog.pin("run-1", RuntimeCapability.entries.toSet()).skills.single().version)
        assertEquals(2, catalog.pin("run-2", RuntimeCapability.entries.toSet()).skills.single().version)
        assertEquals(first, catalog.pin("run-1", RuntimeCapability.entries.toSet()))
    }

    @Test fun pinningExcludesSkillsWhoseRuntimeCapabilitiesAreMissing() {
        val catalog = SkillCatalog()
        catalog.replace(
            SkillSource.BUILT_IN,
            listOf(
                SkillDefinition("chat", 1, "Chat", SkillSource.BUILT_IN, setOf(RuntimeCapability.CHAT)),
                SkillDefinition("files", 1, "Files", SkillSource.BUILT_IN, setOf(RuntimeCapability.SAF_READ)),
            ),
        )
        assertEquals(listOf("chat"), catalog.pin("run", setOf(RuntimeCapability.CHAT)).skills.map { it.id })
    }
}
