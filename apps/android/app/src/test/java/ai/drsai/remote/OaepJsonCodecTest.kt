package ai.drsai.remote

import ai.drsai.remote.remote.data.OaepJsonCodec
import ai.drsai.remote.remote.generated.OaepArtifactContent
import ai.drsai.remote.remote.generated.OaepCommandExecutionContent
import ai.drsai.remote.remote.generated.OaepContract
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepNoticeContent
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class OaepJsonCodecTest {
    private fun fixture(): JSONObject {
        val candidates = listOf(
            File("../../../cores/protocol/oaep/examples.json"),
            File("../../cores/protocol/oaep/examples.json"),
            File("cores/protocol/oaep/examples.json"),
        )
        val raw = JSONObject(candidates.firstOrNull(File::isFile)?.readText()
            ?: error("oaep examples fixture was not found"))
        return expand(raw, raw) as JSONObject
    }

    private fun expand(value: Any, fixture: JSONObject): Any = when (value) {
        is JSONObject -> if (value.length() == 1 && value.has("\$ref")) {
            val match = Regex("items\\[(\\d+)]").matchEntire(value.getString("\$ref"))
                ?: error("unsupported OAEP fixture reference")
            expand(fixture.getJSONArray("items").getJSONObject(match.groupValues[1].toInt()), fixture)
        } else JSONObject().also { copy -> value.keys().forEach { key ->
            copy.put(key, expand(value.get(key), fixture))
        } }
        is JSONArray -> JSONArray().also { copy ->
            repeat(value.length()) { copy.put(expand(value.get(it), fixture)) }
        }
        else -> value
    }

    private fun snapshotFixture(): JSONObject = fixture().also { root ->
        val events = root.getJSONArray("events")
        root.put("snapshot_sequence", events.getJSONObject(events.length() - 1).getLong("sequence"))
    }

    private fun windowFixture(): JSONObject {
        val candidates = listOf(
            File("../../../cores/protocol/oaep/snapshot-window.examples.json"),
            File("../../cores/protocol/oaep/snapshot-window.examples.json"),
            File("cores/protocol/oaep/snapshot-window.examples.json"),
        )
        return JSONObject(candidates.firstOrNull(File::isFile)?.readText()
            ?: error("OAEP Snapshot window fixture was not found"))
    }

    @Test
    fun `official fixture decodes all native OAEP item kinds and OWOP references`() {
        val snapshot = OaepJsonCodec.snapshot(snapshotFixture())
        assertEquals("session-1", snapshot.session.id)
        assertTrue(OaepContract.ITEM_TYPES.containsAll(snapshot.items.map { it.type }.toSet()))
        assertTrue(snapshot.items.first { it.type == "command_execution" }.content is OaepCommandExecutionContent)
        assertTrue(snapshot.items.first { it.type == "artifact" }.content is OaepArtifactContent)
        assertTrue(snapshot.items.flatMap { it.content.resourceRefs }.all {
            it.protocol == "owop/1" && it.workspaceId == snapshot.session.workspaceId
        })
    }

    @Test
    fun `official events decode with exclusive page cursor`() {
        val root = fixture()
        val events = root.getJSONArray("events")
        val page = JSONObject()
            .put("version", "1.0")
            .put("object", "list")
            .put("data", events)
            .put("next_sequence", events.getJSONObject(events.length() - 1).getLong("sequence"))
            .put("has_more", false)
        val decoded = OaepJsonCodec.eventPage(page)
        assertEquals(events.length(), decoded.data.size)
        assertTrue(decoded.data.zipWithNext().all { (left, right) -> left.sequence < right.sequence })
    }

    @Test
    fun `message parts survive strict decode and encode`() {
        val message = snapshotFixture().getJSONArray("items").getJSONObject(0)
        message.getJSONObject("content").put(
            "parts",
            JSONArray().put(JSONObject().put("type", "text").put("text", "visible")),
        )

        val decoded = OaepJsonCodec.item(message)
        val content = decoded.content as OaepMessageContent
        assertEquals("visible", content.parts.single()["text"])
        assertEquals(
            "visible",
            JSONObject(OaepJsonCodec.contentJson(content))
                .getJSONArray("parts")
                .getJSONObject(0)
                .getString("text"),
        )
    }

    @Test
    fun `legacy lookalike and wrong content fail closed`() {
        val legacy = JSONObject()
            .put("session_id", "session-1")
            .put("snapshot_sequence", 1)
            .put("items", JSONArray())
        assertTrue(runCatching { OaepJsonCodec.snapshot(legacy) }.isFailure)

        val root = fixture()
        val message = root.getJSONArray("items").getJSONObject(0)
        message.getJSONObject("content").remove("text")
        assertTrue(runCatching { OaepJsonCodec.item(message) }.isFailure)
    }

    @Test
    fun `bounded snapshot decodes checkpoint and opaque history cursor`() {
        val root = snapshotFixture()
        val sequence = root.getLong("snapshot_sequence")
        root.put("checkpoint", JSONObject()
            .put("sequence", sequence)
            .put("snapshot_hash", "a".repeat(64))
            .put("item_count", root.getJSONArray("items").length()))
        root.put("window", JSONObject()
            .put("limit", 100)
            .put("has_more", true)
            .put("next_cursor", "enc:v1:opaque"))

        val snapshot = OaepJsonCodec.snapshot(root)
        assertEquals(sequence, snapshot.checkpoint?.sequence)
        assertEquals("enc:v1:opaque", snapshot.window?.nextCursor)

        root.getJSONObject("checkpoint").put("sequence", sequence + 1)
        assertEquals(
            "oaep_snapshot_checkpoint_sequence_mismatch",
            runCatching { OaepJsonCodec.snapshot(root) }.exceptionOrNull()?.message,
        )
    }

    @Test
    fun `shared snapshot window fixture decodes every page without gaps`() {
        val fixture = windowFixture()
        val pages = fixture.getJSONArray("pages")
        val ids = buildSet {
            repeat(pages.length()) { pageIndex ->
                OaepJsonCodec.snapshot(pages.getJSONObject(pageIndex)).items.forEach { add(it.id) }
            }
        }
        val expected = fixture.getJSONArray("expected_item_ids")
        assertEquals(
            (0 until expected.length()).map(expected::getString).toSet(),
            ids,
        )
    }

    @Test
    fun `future item and event types degrade without being misclassified`() {
        val root = snapshotFixture()
        val futureItem = root.getJSONArray("items").getJSONObject(0)
            .put("type", "future_visualization")
            .put("content", JSONObject().put("opaque", true))
        val decodedItem = OaepJsonCodec.item(futureItem)
        assertEquals("notice", decodedItem.type)
        assertTrue(decodedItem.content is OaepNoticeContent)

        val futureEvent = root.getJSONArray("events").getJSONObject(0)
            .put("type", "event.future.progress")
        val decodedEvent = OaepJsonCodec.event(futureEvent)
        assertEquals("event.future.progress", decodedEvent.type)
        assertTrue(decodedEvent.data.item == null && decodedEvent.data.delta == null)
    }
}
