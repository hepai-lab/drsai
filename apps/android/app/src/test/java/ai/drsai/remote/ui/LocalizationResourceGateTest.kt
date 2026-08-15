package ai.drsai.remote.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalizationResourceGateTest {
    @Test
    fun chineseAndEnglishResourceKeysStayInLockstep() {
        val app = appDirectory()
        val chinese = resourceNames(File(app, "src/main/res/values/strings.xml"))
        val english = resourceNames(File(app, "src/main/res/values-en/strings.xml"))
        assertEquals("zh-CN and en-US string/plural keys must match exactly", chinese, english)
    }

    @Test
    fun userFacingChineseLiteralDebtNeverIncreases() {
        val main = File(appDirectory(), "src/main/java")
        val quoteWithHan = Regex("\"[^\"\\r\\n]*[\\u4E00-\\u9FFF][^\"\\r\\n]*\"")
        val debt = main.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .flatMap { file -> file.readLines().asSequence().filter(quoteWithHan::containsMatchIn) }
            .count()
        assertTrue("Chinese literal debt grew to $debt; ratchet is $MAX_LOCALIZATION_DEBT", debt <= MAX_LOCALIZATION_DEBT)
    }

    private fun resourceNames(file: File): Set<String> {
        assertTrue("Missing resource file: $file", file.isFile)
        val name = Regex("<(?:string|plurals)\\s+name=\"([^\"]+)\"")
        return name.findAll(file.readText()).map { it.groupValues[1] }.toSet()
    }

    private fun appDirectory(): File = sequenceOf(File("app"), File("."))
        .firstOrNull { File(it, "src/main/res/values/strings.xml").isFile }
        ?: error("Cannot locate Android app module from ${File(".").absolutePath}")

    private companion object {
        const val MAX_LOCALIZATION_DEBT = 0
    }
}
