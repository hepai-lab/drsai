package ai.drsai.remote

import ai.drsai.remote.runtime.tools.*
import org.junit.Assert.*
import org.junit.Test

class UserDeclarativeSkillRepositoryTest {
    @Test fun installRequiresExplicitEnableAndUpdateRollbackDeleteAreVersioned() {
        val persistence = MemoryPersistence()
        val repository = UserDeclarativeSkillRepository(persistence)

        val installed = repository.install("alice", manifest(1, "Read v1."))
        assertFalse(installed.single().enabled)
        assertTrue(repository.enabled("alice").isEmpty())

        repository.setEnabled("alice", ID, true)
        assertEquals(1, repository.enabled("alice").single().version)

        val updated = repository.install("alice", manifest(2, "Read v2."))
        assertFalse(updated.single().enabled)
        assertEquals(listOf(1), updated.single().previous.map { it.version })

        val rolledBack = repository.rollback("alice", ID).single()
        assertEquals(1, rolledBack.current.version)
        assertFalse(rolledBack.enabled)
        assertTrue(repository.delete("alice", ID).isEmpty())
    }

    @Test fun dynamicCodeConflictDowngradeAndCrossAccountAccessFailClosed() {
        val repository = UserDeclarativeSkillRepository(MemoryPersistence())
        repository.install("alice", manifest(2, "Read v2."))
        assertThrows(IllegalStateException::class.java) { repository.install("alice", manifest(1, "Read v1.")) }
        assertThrows(IllegalStateException::class.java) { repository.install("alice", manifest(2, "Changed.")) }
        assertThrows(IllegalStateException::class.java) {
            repository.install("alice", manifest(3, "Read v3.").replace("\"digest\"", "\"script\":\"evil\",\"digest\""))
        }
        assertTrue(repository.snapshot("bob").isEmpty())
    }

    @Test fun runningRunKeepsOldUserSkillWhileNewRunSeesExplicitlyEnabledUpdate() {
        val repository = UserDeclarativeSkillRepository(MemoryPersistence())
        val catalog = SkillCatalog()
        repository.install("alice", manifest(1, "Read v1."))
        repository.setEnabled("alice", ID, true)
        catalog.replace(SkillSource.USER_DECLARATIVE, repository.enabled("alice"))
        assertEquals(1, catalog.select("run-old", emptySet(), "@$ID").skills.single().version)

        repository.install("alice", manifest(2, "Read v2."))
        repository.setEnabled("alice", ID, true)
        catalog.replace(SkillSource.USER_DECLARATIVE, repository.enabled("alice"))
        assertEquals(1, catalog.select("run-old", emptySet(), "@$ID").skills.single().version)
        assertEquals(2, catalog.select("run-new", emptySet(), "@$ID").skills.single().version)
    }

    @Test fun builtInBundleAttestationBindsApkSignerAndContent() {
        val skill = SkillDefinition("built.in", 1, "Built in", SkillSource.BUILT_IN, instructions = "v1")
        val first = BuiltInSkillBundleAttestation.create("1".repeat(64), listOf(skill))
        val signerChanged = BuiltInSkillBundleAttestation.create("2".repeat(64), listOf(skill))
        val contentChanged = BuiltInSkillBundleAttestation.create(
            "1".repeat(64), listOf(skill.copy(version = 2, instructions = "v2", digest = SkillManifestDigest.compute(
                "built.in", 2, SkillSource.BUILT_IN, "v2", emptySet(), emptySet(),
            ))),
        )
        assertNotEquals(first.attestationSha256, signerChanged.attestationSha256)
        assertNotEquals(first.attestationSha256, contentChanged.attestationSha256)
    }

    private fun manifest(version: Int, instructions: String): String {
        val digest = SkillManifestDigest.compute(ID, version, SkillSource.USER_DECLARATIVE, instructions, setOf("workspace.read"), emptySet())
        return """{"schema_version":1,"skills":[{"id":"$ID","version":$version,"name":"User Workspace","instructions":"$instructions","tools":["workspace.read"],"capabilities":[],"digest":"$digest"}]}"""
    }

    private class MemoryPersistence : UserSkillPersistence {
        private val values = mutableMapOf<String, List<UserSkillRecord>>()
        override fun load(accountSubject: String) = values[accountSubject].orEmpty()
        override fun save(accountSubject: String, records: List<UserSkillRecord>) { values[accountSubject] = records }
    }

    companion object { private const val ID = "user.workspace" }
}
