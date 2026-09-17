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
        val strings = source("src/main/res/values/strings.xml")
        assertTrue(ui.contains("state.pendingDesktopHandoff?.let"))
        assertTrue(ui.contains("viewModel.decideDesktopHandoff(true)"))
        assertTrue(ui.contains("viewModel.decideDesktopHandoff(false)"))
        assertTrue(ui.contains("R.string.handoff_dialog_title"))
        assertTrue(ui.contains("R.string.create_handoff"))
        assertTrue(ui.contains("R.string.choose_execution_computer"))
        assertTrue(ui.contains("handoff.targetRuntimeId != null"))
        assertTrue(ui.contains("R.string.handoff_target_location"))
        assertTrue(ui.contains("R.string.handoff_transport"))
        assertTrue(ui.contains("R.string.handoff_stdio_notice"))
        assertTrue(strings.contains("交给 Desktop Runtime？"))
        assertTrue(strings.contains("Android 本地不执行"))
    }

    private fun source(relative: String): String {
        val candidates = listOf(File(relative), File("app/$relative"), File("apps/android/app/$relative"))
        return candidates.firstOrNull(File::isFile)?.readText() ?: error("source_not_found:$relative")
    }
}
