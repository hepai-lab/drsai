package ai.drsai.remote.ui

object ReducedMotionPolicy {
    fun animationsEnabled(systemAnimatorsEnabled: Boolean, userReducedMotion: Boolean = false): Boolean =
        systemAnimatorsEnabled && !userReducedMotion

    fun shouldAnimateScroll(systemAnimatorsEnabled: Boolean, userInitiated: Boolean): Boolean =
        animationsEnabled(systemAnimatorsEnabled) && !userInitiated
}
