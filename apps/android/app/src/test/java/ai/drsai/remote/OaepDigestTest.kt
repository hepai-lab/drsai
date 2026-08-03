package ai.drsai.remote

import ai.drsai.remote.remote.data.OaepJsonCodec
import ai.drsai.remote.remote.model.oaepItemsDigest
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class OaepDigestTest {
    @Test fun official_fixture_digest_is_order_independent_and_content_sensitive() {
        val root = File("../../cores/protocol/oaep/examples.json")
            .takeIf { it.isFile } ?: File("../../../cores/protocol/oaep/examples.json")
        val fixture = JSONObject(root.readText())
        val items = List(fixture.getJSONArray("items").length()) { index ->
            OaepJsonCodec.item(fixture.getJSONArray("items").getJSONObject(index))
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
}
