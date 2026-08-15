package ai.drsai.remote

import ai.drsai.remote.R
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.ui.workspaceCatalogSyncErrorMessage
import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.SocketTimeoutException

class WorkspaceCatalogSyncUiTest {
    @Test
    fun `force sync errors distinguish offline timeout stale generation and network`() {
        assertEquals(
            R.string.remote_sync_offline_cached,
            workspaceCatalogSyncErrorMessage(
                RelayHttpException(503, "safe", "host_offline"),
            ).resourceId,
        )
        assertEquals(
            R.string.remote_sync_timeout_cached,
            workspaceCatalogSyncErrorMessage(
                RelayHttpException(503, "safe", "catalog_sync_timeout"),
            ).resourceId,
        )
        assertEquals(
            R.string.remote_sync_timeout_cached,
            workspaceCatalogSyncErrorMessage(SocketTimeoutException()).resourceId,
        )
        assertEquals(
            R.string.remote_sync_reconnected_cached,
            workspaceCatalogSyncErrorMessage(
                RelayHttpException(409, "safe", "stale_runtime_generation"),
            ).resourceId,
        )
        assertEquals(
            R.string.remote_sync_network_failed_cached,
            workspaceCatalogSyncErrorMessage(java.io.IOException()).resourceId,
        )
    }
}
