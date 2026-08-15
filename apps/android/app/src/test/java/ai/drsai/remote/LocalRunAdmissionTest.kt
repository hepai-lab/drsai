package ai.drsai.remote

import ai.drsai.remote.runtime.readiness.*
import org.junit.Assert.assertEquals
import org.junit.Test

class LocalRunAdmissionTest {
    @Test fun `skipped setup task is deferred before a failed run can be created`() {
        val unready = AgentReadiness(
            kind = ReadinessKind.CONFIGURATION_REQUIRED,
            title = "完成模型配置",
            summary = "需要有效凭据",
            primaryAction = ReadinessAction.ADD_CREDENTIAL,
            canStartAgentRun = false,
            stableReason = "credential_missing",
        )
        assertEquals(LocalRunAdmission.DEFER_WITHOUT_RUN, unready.localRunAdmission())
    }

    @Test fun `ready setup admits a local run`() {
        val ready = AgentReadiness(
            ReadinessKind.READY, "Agent 已就绪", "可以执行任务",
            ReadinessAction.NONE, true, "ready",
        )
        assertEquals(LocalRunAdmission.ADMIT, ready.localRunAdmission())
    }
}
