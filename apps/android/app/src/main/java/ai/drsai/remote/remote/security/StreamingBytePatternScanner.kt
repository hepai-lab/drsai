package ai.drsai.remote.remote.security

import java.io.InputStream

internal data class BytePatternScanResult(
    val matched: Boolean,
    val bytesScanned: Long,
)

/** Streaming multi-pattern scanner for endpoint-local release gates. */
internal class StreamingBytePatternScanner(patterns: List<ByteArray>) {
    private class Node {
        val transitions = IntArray(256) { -1 }
        var failure = 0
        var terminal = false
    }

    private val nodes = mutableListOf(Node())

    init {
        require(patterns.isNotEmpty() && patterns.all { it.isNotEmpty() }) {
            "secret_scanner_patterns_required"
        }
        patterns.forEach { pattern ->
            var state = 0
            pattern.forEach { raw ->
                val value = raw.toInt() and 0xff
                var next = nodes[state].transitions[value]
                if (next < 0) {
                    next = nodes.size
                    nodes[state].transitions[value] = next
                    nodes += Node()
                }
                state = next
            }
            nodes[state].terminal = true
        }
        val queue = ArrayDeque<Int>()
        for (value in 0..255) {
            val child = nodes[0].transitions[value]
            if (child < 0) {
                nodes[0].transitions[value] = 0
            } else {
                nodes[child].failure = 0
                queue.add(child)
            }
        }
        while (queue.isNotEmpty()) {
            val state = queue.removeFirst()
            for (value in 0..255) {
                val child = nodes[state].transitions[value]
                if (child < 0) {
                    nodes[state].transitions[value] =
                        nodes[nodes[state].failure].transitions[value]
                    continue
                }
                val fallback = nodes[nodes[state].failure].transitions[value]
                nodes[child].failure = fallback
                nodes[child].terminal = nodes[child].terminal || nodes[fallback].terminal
                queue.add(child)
            }
        }
    }

    /** Keeps automaton state across reads, including a match split at a chunk boundary. */
    fun scan(input: InputStream, bufferSize: Int = DEFAULT_BUFFER_SIZE): BytePatternScanResult {
        require(bufferSize > 0) { "secret_scanner_buffer_size_invalid" }
        val buffer = ByteArray(bufferSize)
        var state = 0
        var bytesScanned = 0L
        while (true) {
            val count = input.read(buffer)
            if (count < 0) return BytePatternScanResult(false, bytesScanned)
            if (count == 0) continue
            bytesScanned += count
            for (index in 0 until count) {
                state = nodes[state].transitions[buffer[index].toInt() and 0xff]
                if (nodes[state].terminal) return BytePatternScanResult(true, bytesScanned)
            }
        }
    }

    fun contains(input: InputStream, bufferSize: Int = DEFAULT_BUFFER_SIZE): Boolean =
        scan(input, bufferSize).matched

    private companion object {
        const val DEFAULT_BUFFER_SIZE = 64 * 1024
    }
}
