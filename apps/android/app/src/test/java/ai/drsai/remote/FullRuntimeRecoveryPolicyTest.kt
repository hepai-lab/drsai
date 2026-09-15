package ai.drsai.remote

import ai.drsai.remote.runtime.python.FullRuntimeRecoveryAction
import ai.drsai.remote.runtime.python.FullRuntimeRecoveryPolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class FullRuntimeRecoveryPolicyTest {
    @Test fun `runtime loss without side effect pauses for checkpoint resume`() {
        listOf("binder_died", "DeadObjectException", "runtime_process_lost", "service_disconnected").forEach {
            assertEquals(
                FullRuntimeRecoveryAction.PAUSE_AND_RESUME,
                FullRuntimeRecoveryPolicy.decide(it, sideEffectObserved = false),
            )
        }
    }

    @Test fun `runtime loss after side effect requires reconciliation`() {
        assertEquals(
            FullRuntimeRecoveryAction.RECONCILE_SIDE_EFFECT,
            FullRuntimeRecoveryPolicy.decide("binder_died", sideEffectObserved = true),
        )
    }

    @Test fun `ordinary failures are not disguised as runtime recovery`() {
        assertEquals(
            FullRuntimeRecoveryAction.FAIL,
            FullRuntimeRecoveryPolicy.decide("provider_http_400", sideEffectObserved = false),
        )
    }
}
