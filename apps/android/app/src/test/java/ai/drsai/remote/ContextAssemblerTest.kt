package ai.drsai.remote

import ai.drsai.remote.runtime.context.ContextAssembler
import ai.drsai.remote.runtime.context.ContextBudget
import ai.drsai.remote.runtime.context.ContextMessage
import ai.drsai.remote.runtime.context.MemoryPrivacyPolicy
import ai.drsai.remote.runtime.context.PromptFragment
import ai.drsai.remote.runtime.context.ProjectInstructionVersion
import ai.drsai.remote.runtime.context.AttachmentContextBudgeter
import ai.drsai.remote.runtime.context.ImageContextBudgeter
import ai.drsai.remote.runtime.context.ImageContextCandidate
import ai.drsai.remote.runtime.context.PromptLayer
import ai.drsai.remote.runtime.context.TokenEstimator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ContextAssemblerTest {
    @Test fun imageContextHasCountSingleAndTotalByteBudgetsWithReferences() {
        val oneMiB = 1024L * 1024
        val result = ImageContextBudgeter.select(
            listOf(
                ImageContextCandidate("a", "a.jpg", 7 * oneMiB),
                ImageContextCandidate("too-large", "large.jpg", 9 * oneMiB),
                ImageContextCandidate("b", "b.jpg", 5 * oneMiB),
                ImageContextCandidate("over-total", "c.jpg", oneMiB),
                ImageContextCandidate("empty", "empty.jpg", 0),
            ),
        )
        assertEquals(listOf("a", "b"), result.included.map { it.id })
        assertEquals(listOf("too-large", "over-total", "empty"), result.omitted.map { it.id })
        assertTrue(result.referenceNotice!!.contains("large.jpg (too-large)"))
        assertTrue(result.referenceNotice!!.contains("c.jpg (over-total)"))
    }

    @Test fun oversizedAttachmentContextBecomesABoundedReferenceInsteadOfBreakingThePromptBudget() {
        val prepared = AttachmentContextBudgeter.prepare(
            listOf("附件：large.txt\n" + "x".repeat(50_000)),
            maxChars = 2_000,
        )
        assertTrue(prepared.truncated)
        assertTrue(prepared.omittedChars > 40_000)
        assertTrue(prepared.content.length <= 2_000)
        assertTrue(prepared.content.contains("完整内容请通过原附件或结果 Artifact 查看"))
    }
    @Test fun projectInstructionVersionsAreStableAndDetectAddsChangesAndRemovals() {
        val first = listOf(PromptFragment(PromptLayer.PROJECT, "line 1\r\nline 2", "saf:AGENTS.md",
            ProjectInstructionVersion.digest("line 1\nline 2")))
        val same = listOf(PromptFragment(PromptLayer.PROJECT, "line 1\nline 2", "saf:AGENTS.md",
            ProjectInstructionVersion.digest("line 1\r\nline 2")))
        assertTrue(ProjectInstructionVersion.changed(first, same).isEmpty())
        val changed = listOf(
            PromptFragment(PromptLayer.PROJECT, "new", "saf:AGENTS.md", ProjectInstructionVersion.digest("new")),
            PromptFragment(PromptLayer.PROJECT, "extra", "remote:DRSAI.md", ProjectInstructionVersion.digest("extra")),
        )
        assertEquals(setOf("remote:DRSAI.md", "saf:AGENTS.md"), ProjectInstructionVersion.changed(first, changed))
        assertEquals(setOf("saf:AGENTS.md"), ProjectInstructionVersion.changed(first, emptyList()))
    }
    private val wordEstimator = TokenEstimator { value -> value.split(' ').count { it.isNotBlank() } }

    @Test fun promptLayersHaveStableSecurityFirstOrder() {
        val assembly = ContextAssembler(wordEstimator).assemble(
            prompts = listOf(
                PromptFragment(PromptLayer.USER_PREFERENCE, "brief", "user"),
                PromptFragment(PromptLayer.SYSTEM, "safe", "app"),
                PromptFragment(PromptLayer.PROJECT, "build", "project", "v2"),
                PromptFragment(PromptLayer.AGENT, "help", "agent"),
            ),
            history = listOf(ContextMessage("user", "hello")),
            budget = ContextBudget(100, 10),
        )
        val prompt = assembly.messages.first().content
        assertTrue(prompt.indexOf("SYSTEM") < prompt.indexOf("AGENT"))
        assertTrue(prompt.indexOf("AGENT") < prompt.indexOf("PROJECT"))
        assertTrue(prompt.indexOf("PROJECT") < prompt.indexOf("USER_PREFERENCE"))
        assertEquals(listOf("app", "agent", "project", "user"), assembly.includedSources)
    }

    @Test fun newestHistoryFitsBudgetWithoutLeadingToolResult() {
        val assembly = ContextAssembler(wordEstimator).assemble(
            prompts = listOf(PromptFragment(PromptLayer.SYSTEM, "system", "app")),
            history = listOf(
                ContextMessage("user", "very old message"),
                ContextMessage("assistant", "tool call"),
                ContextMessage("tool", "tool result"),
                ContextMessage("user", "latest question"),
            ),
            budget = ContextBudget(7, 1),
        )
        assertEquals("user", assembly.messages[1].role)
        assertEquals("latest question", assembly.messages.last().content)
        assertTrue(assembly.estimatedTokens <= 6)
        assertTrue(assembly.omittedMessages > 0)
    }

    @Test fun summaryAndAttachmentsArePinnedAndRedacted() {
        val assembly = ContextAssembler(wordEstimator).assemble(
            prompts = listOf(PromptFragment(PromptLayer.SYSTEM, "system", "app")),
            history = emptyList(),
            summary = ContextMessage("system", "summary"),
            attachmentContext = listOf(ContextMessage("system", "Bearer abc.def document")),
            budget = ContextBudget(20, 2),
        )
        assertEquals(3, assembly.messages.size)
        assertTrue(assembly.messages.all(ContextMessage::pinned))
        assertFalse(assembly.messages.last().content.contains("abc.def"))
    }

    @Test fun mandatoryContextCannotSilentlyOverflow() {
        assertThrows(IllegalArgumentException::class.java) {
            ContextAssembler(wordEstimator).assemble(
                prompts = listOf(PromptFragment(PromptLayer.SYSTEM, "one two three four", "app")),
                history = emptyList(),
                budget = ContextBudget(4, 1),
            )
        }
    }

    @Test fun memoryPolicyRejectsDisabledSensitiveAndCredentialContent() {
        assertFalse(MemoryPrivacyPolicy(enabled = false).mayPersist("fact", "green"))
        assertFalse(MemoryPrivacyPolicy().mayPersist("secret", "green"))
        assertFalse(MemoryPrivacyPolicy().mayPersist("fact", "Bearer abc.def"))
        assertTrue(MemoryPrivacyPolicy().mayPersist("preference", "prefers concise answers"))
    }
}
