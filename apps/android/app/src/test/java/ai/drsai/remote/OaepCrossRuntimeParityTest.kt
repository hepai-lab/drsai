package ai.drsai.remote

import ai.drsai.remote.remote.model.canonicalOaepJsonDigest
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class OaepCrossRuntimeParityTest {
    private fun protocolFile(name: String) = listOf(
        File("../../cores/protocol/oaep/$name"),
        File("../../../cores/protocol/oaep/$name"),
        File("cores/protocol/oaep/$name"),
    ).first { it.isFile }

    @Test
    fun `Android canonical snapshot and event hashes equal shared Python Desktop manifest`() {
        val document = JSONObject(protocolFile("examples.json").readText())
        val manifest = JSONObject(protocolFile("parity-v1.json").readText())
        val snapshot = JSONObject(document.toString()).also { it.remove("events") }
        assertEquals(manifest.getString("snapshot_sha256"), canonicalOaepJsonDigest(snapshot))
        assertEquals(manifest.getString("events_sha256"), canonicalOaepJsonDigest(document.getJSONArray("events")))
        assertEquals(manifest.getString("document_sha256"), canonicalOaepJsonDigest(document))
    }
}
