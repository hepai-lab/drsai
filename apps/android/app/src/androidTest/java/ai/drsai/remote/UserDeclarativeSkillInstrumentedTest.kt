package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import ai.drsai.remote.runtime.tools.*
import android.content.Context
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class UserDeclarativeSkillInstrumentedTest {
    @Test fun safImportPersistsDisabledThenExplicitEnableLoadsBundledKernelWithoutDynamicCode() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val subject = "instrumented-user-skill"
        val persistence = SharedPreferencesUserSkillPersistence(context)
        val repository = UserDeclarativeSkillRepository(persistence)
        repository.delete(subject, SKILL_ID)

        val instructions = "Read only the user-authorized workspace file."
        val digest = SkillManifestDigest.compute(
            SKILL_ID, 1, SkillSource.USER_DECLARATIVE, instructions, setOf("workspace.read"), emptySet(),
        )
        val manifest = """{"schema_version":1,"skills":[{"id":"$SKILL_ID","version":1,"name":"User Workspace","instructions":"$instructions","tools":["workspace.read"],"capabilities":[],"digest":"$digest"}]}"""
        val directory = File(context.cacheDir, "workbench/artifacts").apply { mkdirs() }
        val file = File(directory, "user-skill.json").apply { writeText(manifest, Charsets.UTF_8) }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)

        val imported = SafUserSkillImporter(context, repository).import(subject, uri).single()
        assertFalse(imported.enabled)
        assertTrue(repository.enabled(subject).isEmpty())
        repository.setEnabled(subject, SKILL_ID, true)
        assertEquals(1, UserDeclarativeSkillRepository(persistence).enabled(subject).single().version)

        val definition = repository.enabled(subject).single()
        val client = PythonRuntimeClient(context)
        try {
            val result = client.execute(start(definition))
            assertEquals("python_runtime_ready", result.status)
            val model = result.outbound.last { it.messageType == PythonRuntimeMessageType.MODEL_REQUEST }.payload
            assertTrue(model.getJSONArray("messages").getJSONObject(0).getString("content")
                .contains("[SKILL id=$SKILL_ID v=1]"))
            assertEquals("workspace.read", model.getJSONArray("tools").getJSONObject(0).getString("name"))
        } finally {
            client.close()
            repository.delete(subject, SKILL_ID)
            file.delete()
        }

        val builtIn = SkillDefinition("built.in", 1, "Built in", SkillSource.BUILT_IN, instructions = "bundled")
        val attestation = BuiltInSkillBundleAttestation.create(context.apkSigningCertificateSha256(), listOf(builtIn))
        assertEquals(64, attestation.attestationSha256.length)
        assertEquals(64, attestation.signingCertificateSha256.length)
    }

    private fun start(skill: SkillDefinition) = PythonRuntimeEnvelope(
        PythonRuntimeMessageType.START_RUN, "user-skill-start", "user-skill-run", "user-skill-session",
        0, "user-skill:start", JSONObject()
            .put("input", "@${skill.id} inspect file")
            .put("model_id", "probe-model")
            .put("tools", JSONArray().put(JSONObject()
                .put("name", "workspace.read").put("version", 1).put("source", "android-host")
                .put("classification", "local-equivalent").put("description", "Read workspace")
                .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject()))
                .put("required_capabilities", JSONArray())
                .put("risk", "read_only").put("requires_approval", false)))
            .put("skills", JSONArray().put(JSONObject()
                .put("id", skill.id).put("version", skill.version).put("source", "user_declarative")
                .put("availability", "local").put("instructions", skill.instructions)
                .put("tools", JSONArray(skill.allowedTools.sorted()))
                .put("capabilities", JSONArray()).put("digest", skill.digest))),
    )

    companion object { private const val SKILL_ID = "user.workspace" }
}
