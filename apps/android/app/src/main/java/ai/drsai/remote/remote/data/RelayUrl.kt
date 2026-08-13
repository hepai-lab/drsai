package ai.drsai.remote.remote.data

import okhttp3.HttpUrl

/** Builds a Relay URL without treating opaque resource identifiers as path syntax. */
internal fun HttpUrl.withRelayPath(
    segments: List<String>,
    queries: List<Pair<String, String>> = emptyList(),
): HttpUrl {
    require(segments.isNotEmpty() && segments.all { it.isNotEmpty() && '\u0000' !in it }) {
        "relay_path_segments_invalid"
    }
    return newBuilder().apply {
        segments.forEach(::addPathSegment)
        queries.forEach { (name, value) ->
            require(name.isNotEmpty() && '\u0000' !in name && '\u0000' !in value) {
                "relay_query_invalid"
            }
            addQueryParameter(name, value)
        }
    }.build()
}
