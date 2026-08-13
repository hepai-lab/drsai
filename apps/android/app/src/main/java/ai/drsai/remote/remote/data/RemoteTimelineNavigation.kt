package ai.drsai.remote.remote.data

data class RemoteTimelineUpdate(
    val unreadStart: Int?,
    val scrollToLatest: Boolean,
)

/** Pure long-session navigation policy shared by the Compose timeline and tests. */
fun reduceRemoteTimelineUpdate(
    previousCount: Int,
    currentCount: Int,
    followLatest: Boolean,
    currentUnreadStart: Int?,
    historyRestored: Boolean = false,
    searchActive: Boolean = false,
): RemoteTimelineUpdate {
    require(previousCount >= 0 && currentCount >= 0) { "remote_timeline_count_invalid" }
    if (historyRestored) return RemoteTimelineUpdate(currentUnreadStart, false)
    val added = currentCount > previousCount
    if (searchActive) {
        return RemoteTimelineUpdate(
            if (added && currentUnreadStart == null) previousCount else currentUnreadStart,
            false,
        )
    }
    if (currentCount > 0 && (previousCount == 0 || followLatest)) {
        return RemoteTimelineUpdate(null, true)
    }
    return RemoteTimelineUpdate(
        if (added && currentUnreadStart == null) previousCount else currentUnreadStart,
        false,
    )
}
