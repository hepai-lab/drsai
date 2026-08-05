package ai.drsai.remote.runtime.python

import android.content.Context
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform

class ChaquopyRuntimeExecutor(private val context: Context) {
    @Synchronized
    fun execute(envelopeJson: String): String {
        if (!Python.isStarted()) Python.start(AndroidPlatform(context.applicationContext))
        return Python.getInstance()
            .getModule("runtime_probe")
            .callAttr("execute", envelopeJson)
            .toString()
    }

    fun started(): Boolean = Python.isStarted()

    @Synchronized
    fun reset() {
        if (Python.isStarted()) Python.getInstance().getModule("runtime_probe").callAttr("reset")
    }
}
