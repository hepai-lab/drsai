package ai.drsai.remote

import ai.drsai.remote.remote.data.OaepJsonCodec
import ai.drsai.remote.remote.model.oaepItemsDigest
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OaepDigestTest {
    @Test fun official_fixture_digest_is_order_independent_and_content_sensitive() {
        val root = File("../../cores/protocol/oaep/examples.json")
            .takeIf { it.isFile } ?: File("../../../cores/protocol/oaep/examples.json")
        val fixture = JSONObject(root.readText())
        val items = List(fixture.getJSONArray("items").length()) { index ->
            OaepJsonCodec.item(fixture.getJSONArray("items").getJSONObject(index))
        }
        val expectedById = mapOf(
            "message-user-1" to "396c8a3d91bed3882ee1943a285d8938249b633708cee539e05bfe9891ee6ef2",
            "reasoning-1" to "dcadee2a7ab156c7146a5a96d18821b98a04b4571a3302fe3fc8ee288c7dc019",
            "command-1" to "1b5380b534479ee991554348d42f17a9a84f83f544b5b9ba62116180f8e10620",
            "tool-1" to "6b06683e5039dc48a4a45928d70ae9c21dc323be2f203f6345569c6f954d93b7",
        )
        expectedById.forEach { (id, digest) ->
            assertEquals("semantic OAEP digest drift for $id", digest, oaepItemsDigest(listOf(items.first { it.id == id })))
        }
        assertEquals(
            "868d42660d23d7934cdff0faa5bc1258908ce68edc034e3b50e9f473838eed02",
            oaepItemsDigest(items),
        )
        assertEquals(oaepItemsDigest(items), oaepItemsDigest(items.reversed()))
        val changedJson = OaepJsonCodec.itemJson(items.first()).put(
            "content",
            OaepJsonCodec.itemJson(items.first()).getJSONObject("content").put("text", "changed"),
        )
        val changed = listOf(OaepJsonCodec.item(changedJson)) + items.drop(1)
        assertNotEquals(oaepItemsDigest(items), oaepItemsDigest(changed))
    }

    @Test fun pending_tool_null_result_survives_canonical_round_trip() {
        val root = File("../../cores/protocol/oaep/examples.json")
            .takeIf { it.isFile } ?: File("../../../cores/protocol/oaep/examples.json")
        val fixture = JSONObject(root.readText())
        val source = fixture.getJSONArray("items").let { values ->
            (0 until values.length()).map(values::getJSONObject)
                .first { it.getString("type") == "tool_call" }
        }
        val pending = JSONObject(source.toString())
            .put("status", "pending")
            .also { it.getJSONObject("content").put("result", JSONObject.NULL) }
        val decoded = OaepJsonCodec.item(pending)

        assertTrue(OaepJsonCodec.itemJson(decoded).getJSONObject("content").isNull("result"))
        assertEquals(
            "595570630b017370a4511868437d91a76c4637fbcae9f94c7a0ec8866168fc5e",
            oaepItemsDigest(listOf(decoded)),
        )
    }
}
