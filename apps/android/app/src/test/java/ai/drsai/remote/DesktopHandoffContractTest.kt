package ai.drsai.remote

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class DesktopHandoffContractTest {
    @Test fun desktopExclusivePreflightRunsBeforeUploadsAndLocalAgentExecution() {
        val viewModel = source("src/main/java/ai/drsai/remote/AppViewModel.kt")
        val preflight = viewModel.indexOf("interceptDesktopExclusiveRequest(user.id, clean, drafts, handoffRequest)")
        val upload = viewModel.indexOf("attachmentRepository.upload(")
        val execution = viewModel.indexOf("journaledChatExecution.execute(")

        assertTrue(preflight >= 0)
        assertTrue(upload > preflight)
        assertTrue(execution > preflight)
        assertTrue(viewModel.contains("HandoffPackageFactory.create("))
        assertTrue(viewModel.contains("confirmed = true"))
        assertTrue(viewModel.contains("AppRoute.RemoteHome.path"))
        assertTrue(viewModel.contains("handoff_attachment_digest_invalid"))
        assertTrue(viewModel.contains("DesktopHandoffOaep.offered"))
        assertTrue(viewModel.indexOf("persistOaepEvents(", viewModel.indexOf("private suspend fun interceptDesktopExclusiveRequest")) <
            viewModel.indexOf("pendingDesktopHandoff = DesktopHandoffUi("))
    }

    @Test fun handoffIsUserVisibleAndRequiresAnExplicitDecision() {
        val ui = source("src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt")
        assertTrue(ui.contains("state.pendingDesktopHandoff?.let"))
        assertTrue(ui.contains("viewModel.decideDesktopHandoff(true)"))
        assertTrue(ui.contains("viewModel.decideDesktopHandoff(false)"))
        assertTrue(ui.contains("交给 Desktop Runtime？"))
        assertTrue(ui.contains("打开远程 Runtime"))
        assertTrue(ui.contains("执行位置：${'$'}{handoff.executionLocation}"))
        assertTrue(ui.contains("Android 本地不执行"))
        assertTrue(ui.contains("远端工具调用仍需审批"))
    }

    private fun source(relative: String): String {
        val candidates = listOf(File(relative), File("app/$relative"), File("apps/android/app/$relative"))
        return candidates.firstOrNull(File::isFile)?.readText() ?: error("source_not_found:$relative")
    }
}
