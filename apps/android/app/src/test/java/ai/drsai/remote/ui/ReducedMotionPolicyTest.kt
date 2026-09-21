package ai.drsai.remote.ui

import org.junit.Assert.*
import org.junit.Test

class ReducedMotionPolicyTest {
    @Test fun system_or_user_reduced_motion_disables_nonessential_animation() {
        assertFalse(ReducedMotionPolicy.animationsEnabled(false))
        assertFalse(ReducedMotionPolicy.animationsEnabled(true, userReducedMotion = true))
        assertTrue(ReducedMotionPolicy.animationsEnabled(true))
        assertFalse(ReducedMotionPolicy.shouldAnimateScroll(true, userInitiated = true))
    }
}
