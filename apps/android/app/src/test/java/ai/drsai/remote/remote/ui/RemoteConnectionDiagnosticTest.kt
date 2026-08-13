package ai.drsai.remote.remote.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RemoteConnectionDiagnosticTest {
    private val ok = RemoteConnectionDiagnosticInput(
        computer = RemoteDiagnosticCheck.OK,
        platform = RemoteDiagnosticCheck.OK,
        account = RemoteDiagnosticCheck.OK,
        deviceIdentity = RemoteDiagnosticCheck.OK,
        protocol = RemoteDiagnosticCheck.OK,
        notifications = RemoteDiagnosticCheck.OK,
    )

    @Test fun sevenFixturesProduceExactlyOneSafeSuggestion() {
        val fixtures = listOf(
            ok,
            ok.copy(computer = RemoteDiagnosticCheck.FAILED),
            ok.copy(platform = RemoteDiagnosticCheck.FAILED),
            ok.copy(account = RemoteDiagnosticCheck.FAILED),
            ok.copy(deviceIdentity = RemoteDiagnosticCheck.FAILED),
            ok.copy(protocol = RemoteDiagnosticCheck.FAILED),
            ok.copy(notifications = RemoteDiagnosticCheck.FAILED),
        )
        assertEquals(
            listOf(
                RemoteDiagnosticAction.NONE,
                RemoteDiagnosticAction.START_COMPUTER,
                RemoteDiagnosticAction.RETRY_CONNECTION,
                RemoteDiagnosticAction.SIGN_IN,
                RemoteDiagnosticAction.REPAIR_DEVICE,
                RemoteDiagnosticAction.UPDATE,
                RemoteDiagnosticAction.ENABLE_NOTIFICATIONS,
            ),
            fixtures.map(::diagnoseRemoteConnection).map(RemoteConnectionDiagnostic::action),
        )
        fixtures.map(::diagnoseRemoteConnection).forEach {
            assertFalse(Regex("runtime|relay|oidc|proof|wss|generation", RegexOption.IGNORE_CASE)
                .containsMatchIn("${it.title} ${it.reason} ${it.actionLabel}"))
        }
    }

    @Test fun unknownChecksNeverInventAFailure() {
        val unknown = ok.copy(computer = RemoteDiagnosticCheck.UNKNOWN, notifications = RemoteDiagnosticCheck.UNKNOWN)
        assertEquals(RemoteDiagnosticAction.NONE, diagnoseRemoteConnection(unknown).action)
    }

    @Test fun englishDiagnosticsPreservePriorityAndExposeOneAction() {
        val input = ok.copy(account = RemoteDiagnosticCheck.FAILED, notifications = RemoteDiagnosticCheck.FAILED)
        val result = diagnoseRemoteConnection(input, RemoteUiLanguage.EN)
        assertEquals(RemoteDiagnosticAction.SIGN_IN, result.action)
        assertEquals("Sign in", result.actionLabel)
        assertEquals("Sign-in required", result.title)
    }
}
