package ai.drsai.remote.runtime.python

import android.content.Context
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform

class ChaquopyRuntimeExecutor(private val context: Context) {
    @Synchronized
    fun health(): String {
        ensureStarted()
        return Python.getInstance().getModule("runtime_probe").callAttr("health").toString()
    }

    @Synchronized
    fun execute(envelopeJson: String): String {
        ensureStarted()
        return Python.getInstance()
            .getModule("runtime_probe")
            .callAttr("execute", envelopeJson)
            .toString()
    }

    fun started(): Boolean = Python.isStarted()

    private fun ensureStarted() {
        if (!Python.isStarted()) Python.start(AndroidPlatform(context.applicationContext))
    }

    @Synchronized
    fun reset() {
        if (Python.isStarted()) Python.getInstance().getModule("runtime_probe").callAttr("reset")
    }
}
