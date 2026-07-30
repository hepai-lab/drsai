package ai.drsai.remote

import ai.drsai.remote.remote.generated.GeneratedSessionConversationItem
import ai.drsai.remote.remote.model.sessionConversationDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class SessionConversationDigestTest {
    private fun item(
        id: String,
        sequence: Long,
        payload: Map<String, Any?>,
    ) = GeneratedSessionConversationItem(
        itemId = id,
        sessionId = "session-one",
        runId = "run-one",
        kind = "message",
        role = "user",
        revision = 1,
        sessionSequence = sequence,
        sourceClient = "windows",
        sourceMessageId = "source-$id",
        createdAt = "ignored-created-$id",
        updatedAt = "ignored-updated-$id",
        payload = payload,
    )

    @Test
    fun digestIsStableAcrossInputAndMapOrderingAndTransportTimestamps() {
        val first = item("one", 1, linkedMapOf("z" to 2, "a" to listOf(true, "值")))
        val second = item("two", 2, mapOf("content" to "hello"))
        val reordered = first.copy(
            createdAt = "different",
            updatedAt = "different",
            payload = linkedMapOf("a" to listOf(true, "值"), "z" to 2),
        )
        val digest = sessionConversationDigest(listOf(first, second))
        assertEquals(digest, sessionConversationDigest(listOf(second, reordered)))
        assertEquals(
            "ea44f0e94828575e7dffdd66a0c1512580bf338c0549d2b7b04686078feaf3c9",
            digest,
        )
    }

    @Test
    fun digestChangesForVisiblePayloadRevisionOrSourceIdentity() {
        val baseline = item("one", 1, mapOf("content" to "hello"))
        val digest = sessionConversationDigest(listOf(baseline))
        assertNotEquals(
            digest,
            sessionConversationDigest(
                listOf(baseline.copy(payload = mapOf("content" to "changed"))),
            ),
        )
        assertNotEquals(
            digest,
            sessionConversationDigest(listOf(baseline.copy(revision = 2))),
        )
        assertNotEquals(
            digest,
            sessionConversationDigest(listOf(baseline.copy(sourceClient = "android"))),
        )
    }
}
