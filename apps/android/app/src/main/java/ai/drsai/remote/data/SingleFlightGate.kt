package ai.drsai.remote.data

import java.util.concurrent.atomic.AtomicBoolean

/** Prevents duplicate submissions while one operation is still in flight. */
internal class SingleFlightGate {
    private val entered = AtomicBoolean(false)

    fun tryEnter(): Boolean = entered.compareAndSet(false, true)

    fun leave() {
        entered.set(false)
    }

    fun isEntered(): Boolean = entered.get()
}
