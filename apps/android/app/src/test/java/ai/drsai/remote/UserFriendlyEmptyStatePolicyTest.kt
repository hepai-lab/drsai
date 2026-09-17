package ai.drsai.remote

import ai.drsai.remote.runtime.readiness.*
import org.junit.Assert.*
import org.junit.Test

class UserFriendlyEmptyStatePolicyTest {
    @Test fun `every empty state exposes exactly one stable recommended action`() {
        EmptyStateKind.entries.forEach { kind ->
            val state = UserFriendlyEmptyStatePolicy.present(kind, setOf("chat", "web_search"))
            assertEquals(kind, state.kind)
            assertTrue(state.primaryAction.id.isNotBlank())
        }
    }

    @Test fun `examples are filtered by current capabilities`() {
        val chat = UserFriendlyEmptyStatePolicy.present(EmptyStateKind.NO_SESSIONS, setOf("chat"))
        assertEquals(listOf("chat"), chat.exampleIds)
        val tools = UserFriendlyEmptyStatePolicy.present(EmptyStateKind.CAPABILITY_CHANGED, setOf("workspace_read"))
        assertEquals(listOf("workspace"), tools.exampleIds)
        assertTrue(UserFriendlyEmptyStatePolicy.present(EmptyStateKind.NO_RESULTS).exampleIds.isEmpty())
    }
}
