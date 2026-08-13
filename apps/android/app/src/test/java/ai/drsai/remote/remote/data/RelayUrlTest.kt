package ai.drsai.remote.remote.data

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class RelayUrlTest {
    @Test
    fun `opaque ids remain one encoded path segment`() {
        val values = listOf("a/b", "a%b", "a?b", "a#b", "a b", "会话/一")
        values.forEach { value ->
            val url = "https://relay.example/api/runtime-relay/".toHttpUrl().withRelayPath(
                listOf("v1", "sessions", value, "events"),
            )
            assertEquals(listOf("api", "runtime-relay", "v1", "sessions", value, "events"),
                url.pathSegments)
        }
    }

    @Test
    fun `query values cannot become path or a second query`() {
        val url = "https://relay.example/".toHttpUrl().withRelayPath(
            listOf("v1", "events"),
            listOf("cursor" to "a&admin=true#fragment"),
        )
        assertEquals("a&admin=true#fragment", url.queryParameter("cursor"))
        assertEquals(null, url.queryParameter("admin"))
    }

    @Test
    fun `empty and nul values fail closed`() {
        assertThrows(IllegalArgumentException::class.java) {
            "https://relay.example/".toHttpUrl().withRelayPath(emptyList())
        }
        assertThrows(IllegalArgumentException::class.java) {
            "https://relay.example/".toHttpUrl().withRelayPath(listOf("v1", ""))
        }
        assertThrows(IllegalArgumentException::class.java) {
            "https://relay.example/".toHttpUrl().withRelayPath(listOf("v1", "bad\u0000id"))
        }
    }
}
