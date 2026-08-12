package ai.drsai.remote.remote.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Coalesces process-wide reads for the same authoritative resource key. */
class RemoteSingleFlight(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
    private val capacity: Int = 128,
) {
    private val mutex = Mutex()
    private val active = mutableMapOf<String, Deferred<Any?>>()

    init {
        require(capacity in 1..1024) { "single_flight_capacity_invalid" }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun <T> run(key: String, operation: suspend () -> T): T {
        require(key.isNotBlank()) { "single_flight_key_required" }
        val deferred = mutex.withLock {
            active[key] ?: run {
                check(active.size < capacity) { "single_flight_capacity_exceeded" }
                scope.async { operation() }.also { active[key] = it }
            }
        } as Deferred<T>
        return try {
            deferred.await()
        } finally {
            mutex.withLock {
                if (active[key] === deferred) active.remove(key)
            }
        }
    }

    suspend fun activeCount(): Int = mutex.withLock { active.size }
}
