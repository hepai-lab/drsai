package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SkillManifestInstrumentedTest {
    @Test fun bundledKernelLoadsValidSkillAndRejectsTampering() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val client = PythonRuntimeClient(context)
        try {
            val valid = client.execute(start("valid", "Inspect before answering.", VALID_DIGEST))
            assertEquals("python_runtime_ready", valid.status)
            val model = valid.outbound.last { it.messageType == PythonRuntimeMessageType.MODEL_REQUEST }.payload
            assertTrue(model.getJSONArray("messages").getJSONObject(0).getString("content")
                .contains("[SKILL id=workspace.inspect v=3]"))
            val snapshot = valid.outbound.first { it.messageType == PythonRuntimeMessageType.CHECKPOINT_REQUEST }
                .payload.getJSONObject("state").getJSONObject("capability_snapshot")
            val skill = snapshot.getJSONArray("skills").getJSONObject(0)
            assertEquals(VALID_DIGEST, skill.getString("digest"))
            assertEquals("workspace.read", skill.getJSONArray("allowed_tools").getString(0))

            val tampered = client.execute(start("tampered", "Tampered after signing.", VALID_DIGEST))
            assertEquals("python_runtime_failed", tampered.status)
            assertTrue(tampered.error.orEmpty().contains("run_skill_digest_mismatch"))
        } finally {
            client.close()
        }
    }

    private fun start(suffix: String, instructions: String, digest: String) = PythonRuntimeEnvelope(
        PythonRuntimeMessageType.START_RUN, "skill-$suffix-request", "skill-$suffix-run", "skill-$suffix-session",
        0, "skill:$suffix:start", JSONObject()
            .put("input", "inspect workspace").put("model_id", "probe-model")
            .put("host_capabilities", JSONArray().put("saf_read"))
            .put("tools", JSONArray().put(JSONObject()
                .put("name", "workspace.read").put("version", 1).put("source", "android-host")
                .put("classification", "local-equivalent").put("description", "Read workspace")
                .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject()))
                .put("required_capabilities", JSONArray().put("saf_read"))
                .put("risk", "read_only").put("requires_approval", false)))
            .put("skills", JSONArray().put(JSONObject()
                .put("id", "workspace.inspect").put("version", 3).put("source", "built_in")
                .put("availability", "local").put("instructions", instructions)
                .put("tools", JSONArray().put("workspace.read"))
                .put("capabilities", JSONArray().put("saf_read")).put("digest", digest))),
    )

    companion object {
        private const val VALID_DIGEST = "710098009cdbed16a1882c1f79f78d66aed833adc75d7e79ce5e83ec4401dd69"
    }
}
