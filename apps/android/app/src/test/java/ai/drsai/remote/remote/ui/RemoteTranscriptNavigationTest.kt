package ai.drsai.remote.remote.ui

import kotlin.system.measureTimeMillis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteTranscriptNavigationTest {
    @Test fun filtersTenThousandItemsWithoutCopyingUnrelatedContent() {
        val items = (0 until 10_000).map { index ->
            when (index % 4) {
                0 -> RemoteMessageUi("m-$index", "assistant", "run", kind = "run.completed", runId = "r-$index")
                1 -> RemoteMessageUi("m-$index", "assistant", "tool", kind = "tool.call")
                2 -> RemoteMessageUi("m-$index", "assistant", "file", kind = "file.changed")
                else -> RemoteMessageUi("m-$index", "assistant", "message")
            }
        }
        var tools: List<RemoteMessageUi> = emptyList()
        val elapsed = measureTimeMillis {
            tools = filterRemoteTranscript(items, RemoteTranscriptFilter.TOOL)
            assertEquals(2_500, filterRemoteTranscript(items, RemoteTranscriptFilter.RUN).size)
            assertEquals(2_500, filterRemoteTranscript(items, RemoteTranscriptFilter.FILE).size)
        }
        assertEquals(2_500, tools.size)
        assertTrue("10k transcript filter took ${elapsed}ms", elapsed < 1_000)
        assertEquals(items, filterRemoteTranscript(items, RemoteTranscriptFilter.ALL))
    }
}
