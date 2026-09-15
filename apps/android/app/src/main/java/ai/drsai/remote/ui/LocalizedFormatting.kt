package ai.drsai.remote.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import java.text.DateFormat
import java.text.NumberFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object LocalizedFormatting {
    fun bytes(value: Long, locale: Locale): String {
        require(value >= 0) { "localized_bytes_negative" }
        val (amount, unit) = when {
            value >= 1024L * 1024 -> value / 1024.0 / 1024.0 to "MB"
            value >= 1024 -> value / 1024.0 to "KB"
            else -> value.toDouble() to "B"
        }
        val format = NumberFormat.getNumberInstance(locale).apply {
            maximumFractionDigits = if (unit == "B") 0 else 1
            minimumFractionDigits = 0
        }
        return "${format.format(amount)} $unit"
    }

    fun dateTime(epochMillis: Long, locale: Locale, timeZone: TimeZone): String =
        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, locale).apply {
            this.timeZone = timeZone
        }.format(Date(epochMillis))

    fun count(value: Int, locale: Locale): String {
        require(value >= 0) { "localized_count_negative" }
        return NumberFormat.getIntegerInstance(locale).format(value)
    }
}

@Composable
fun localizedBytes(value: Long): String {
    val locale = Locale.forLanguageTag(LocalConfiguration.current.locales[0].toLanguageTag())
    return LocalizedFormatting.bytes(value, locale)
}

@Composable
fun localizedDateTime(epochMillis: Long): String {
    val locale = Locale.forLanguageTag(LocalConfiguration.current.locales[0].toLanguageTag())
    return LocalizedFormatting.dateTime(epochMillis, locale, TimeZone.getDefault())
}

@Composable
fun localizedDateTime(value: String): String {
    val epochMillis = runCatching { java.time.Instant.parse(value).toEpochMilli() }
        .recoverCatching { value.toLong() }
        .getOrNull() ?: return value
    return localizedDateTime(epochMillis)
}
