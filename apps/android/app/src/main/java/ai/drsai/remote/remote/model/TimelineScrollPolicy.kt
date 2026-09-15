package ai.drsai.remote.remote.model

object TimelineScrollPolicy {
    fun isAtBottom(lastVisibleIndex: Int, totalItems: Int, threshold: Int = 1): Boolean =
        totalItems == 0 || lastVisibleIndex >= totalItems - 1 - threshold

    fun shouldFollowLatest(userFollowing: Boolean, imeVisible: Boolean): Boolean =
        userFollowing || imeVisible
}
