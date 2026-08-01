package ai.drsai.remote

import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.ui.workspaceCatalogSyncErrorMessage
import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.SocketTimeoutException

class WorkspaceCatalogSyncUiTest {
    @Test
    fun `force sync errors distinguish offline timeout stale generation and network`() {
        assertEquals(
            "远程电脑离线，未同步；继续显示上次内容",
            workspaceCatalogSyncErrorMessage(
                RelayHttpException(503, "safe", "host_offline"),
            ),
        )
        assertEquals(
            "同步超时；继续显示上次内容",
            workspaceCatalogSyncErrorMessage(
                RelayHttpException(503, "safe", "catalog_sync_timeout"),
            ),
        )
        assertEquals(
            "同步超时；继续显示上次内容",
            workspaceCatalogSyncErrorMessage(SocketTimeoutException()),
        )
        assertEquals(
            "远程电脑刚刚重连，请稍后重试；继续显示上次内容",
            workspaceCatalogSyncErrorMessage(
                RelayHttpException(409, "safe", "stale_runtime_generation"),
            ),
        )
        assertEquals(
            "网络连接失败，未同步；继续显示上次内容",
            workspaceCatalogSyncErrorMessage(java.io.IOException()),
        )
    }
}
