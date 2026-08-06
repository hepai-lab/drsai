package ai.drsai.remote.remote.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteCommandStateTest {
    @Test fun deliveryStateExplainsRequestBeforeAndAfterNetworkUncertainty() {
        assertTrue(canTransitionDelivery(RemoteDeliveryState.OPTIMISTIC, RemoteDeliveryState.SENDING))
        assertTrue(canTransitionDelivery(RemoteDeliveryState.SENDING, RemoteDeliveryState.ACCEPTED))
        assertTrue(canTransitionDelivery(RemoteDeliveryState.SENDING, RemoteDeliveryState.UNCERTAIN))
        assertTrue(canTransitionDelivery(RemoteDeliveryState.UNCERTAIN, RemoteDeliveryState.COMPLETED))
        assertTrue(canTransitionDelivery(RemoteDeliveryState.ACCEPTED, RemoteDeliveryState.RUNNING))
        assertTrue(canTransitionDelivery(RemoteDeliveryState.RUNNING, RemoteDeliveryState.COMPLETED))
        assertFalse(canTransitionDelivery(RemoteDeliveryState.COMPLETED, RemoteDeliveryState.SENDING))
        assertFalse(canTransitionDelivery(RemoteDeliveryState.SENDING, RemoteDeliveryState.COMPLETED))
    }

    @Test fun approvalStatusAndAuditActionsConvergeToOneTerminalState() {
        assertEquals(RemoteApprovalDecisionState.APPROVED, approvalDecisionState("approved"))
        assertEquals(RemoteApprovalDecisionState.APPROVED, approvalDecisionState("approval.approved"))
        assertEquals(RemoteApprovalDecisionState.DENIED, approvalDecisionState("approval.denied"))
        assertEquals(RemoteApprovalDecisionState.CANCELLED, approvalDecisionState("canceled"))
        assertEquals(RemoteApprovalDecisionState.EXPIRED, approvalDecisionState("approval.expired"))
        assertNull(approvalDecisionState("unknown"))
    }

    @Test fun deliveryFailureDistinguishesBeforeAndAfterSideEffectBoundary() {
        assertEquals(RemoteDeliveryState.FAILED, deliveryFailureState(false, true))
        assertEquals(RemoteDeliveryState.FAILED, deliveryFailureState(true, false))
        assertEquals(RemoteDeliveryState.UNCERTAIN, deliveryFailureState(true, true))
    }
}
