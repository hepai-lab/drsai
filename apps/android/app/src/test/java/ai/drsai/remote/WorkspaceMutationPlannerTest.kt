package ai.drsai.remote

import ai.drsai.remote.runtime.device.WorkspaceMutationJournal
import ai.drsai.remote.runtime.device.WorkspaceMutationPlanner
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceMutationPlannerTest {
    @Test fun previewContainsTargetDiffDigestsAndStableToken() {
        val plan = WorkspaceMutationPlanner.plan("write", "notes/a.txt", null, "hello\n")
        val preview = JSONObject(plan.previewJson())
        assertEquals("notes/a.txt", preview.getString("path"))
        assertEquals("missing", preview.getString("before_sha256"))
        assertEquals(64, preview.getString("after_sha256").length)
        assertTrue(preview.getString("diff").contains("+++ b/notes/a.txt"))
        assertTrue(preview.getString("diff").contains("+hello"))
        assertEquals(plan.token, preview.getString("mutation_token"))
        assertEquals(plan, WorkspaceMutationPlanner.plan("write", "notes/a.txt", null, "hello\n"))
    }

    @Test fun commitIsConflictCheckedExactlyOnceAndReplayDoesNotApplyAgain() {
        val journal = WorkspaceMutationJournal()
        var current: String? = "old"
        var applyCount = 0
        val plan = WorkspaceMutationPlanner.plan("edit", "a.txt", current, "new")
        journal.prepare("alice", "call-1", plan)
        current = "external change"
        assertThrows(IllegalArgumentException::class.java) {
            journal.commit("alice", "call-1", { current }) { current = it.after; applyCount += 1 }
        }
        assertEquals(0, applyCount)
        current = "old"
        val first = journal.commit("alice", "call-1", { current }) { current = it.after; applyCount += 1 }
        val replay = journal.commit("alice", "call-1", { current }) { current = it.after; applyCount += 1 }
        assertFalse(first.replayed)
        assertTrue(replay.replayed)
        assertEquals("new", current)
        assertEquals(1, applyCount)
    }

    @Test fun undoRequiresSeparateApprovalAndCannotCrossAccountBoundary() {
        val journal = WorkspaceMutationJournal()
        var current: String? = "before"
        val original = WorkspaceMutationPlanner.plan("write", "a.txt", current, "after")
        journal.prepare("alice", "write-call", original)
        journal.commit("alice", "write-call", { current }) { current = it.after }
        assertThrows(IllegalStateException::class.java) {
            journal.planUndo("bob", "undo-call", original.token) { current }
        }
        val undo = journal.planUndo("alice", "undo-call", original.token) { current }
        assertEquals("undo", undo.operation)
        assertEquals("before", undo.after)
        journal.commit("alice", "undo-call", { current }) { current = it.after }
        assertEquals("before", current)
    }
}
