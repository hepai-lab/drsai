package ai.drsai.remote

import ai.drsai.remote.data.MemoryEntity
import ai.drsai.remote.runtime.python.MemoryCandidateEnvelope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MemoryCandidateEnvelopeTest {
    @Test fun onlyCallingSubjectMemoriesEnterKernelEnvelope() {
        val payload = MemoryCandidateEnvelope.from(
            "alice", true,
            listOf(MemoryEntity(id = 7, userId = "alice", content = "prefers concise answers")),
        )

        assertEquals(1, payload.length())
        assertEquals("memory-8230bdd7c8d390f7e18d0976", payload.getJSONObject(0).getString("id"))
        assertEquals("prefers concise answers", payload.getJSONObject(0).getString("content"))
    }

    @Test fun disabledMemoryProvidesNoCandidates() {
        val payload = MemoryCandidateEnvelope.from(
            "alice", false,
            listOf(MemoryEntity(id = 7, userId = "alice", content = "prefers concise answers")),
        )
        assertEquals(0, payload.length())
    }

    @Test fun crossSubjectCandidateFailsClosed() {
        assertThrows(IllegalArgumentException::class.java) {
            MemoryCandidateEnvelope.from(
                "alice", true,
                listOf(MemoryEntity(id = 8, userId = "bob", content = "private preference")),
            )
        }
    }
}
