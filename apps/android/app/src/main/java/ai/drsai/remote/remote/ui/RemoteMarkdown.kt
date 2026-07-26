package ai.drsai.remote.remote.ui

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle

/**
 * A deliberately small, offline Markdown renderer for remote transcripts.
 * It styles headings, bold spans and inline code without WebView/network HTML.
 */
fun remoteMarkdown(value: String): AnnotatedString = buildAnnotatedString {
    val text = value.take(100_000)
    var index = 0
    while (index < text.length) {
        if ((index == 0 || text[index - 1] == '\n') && text.startsWith("# ", index)) {
            val end = text.indexOf('\n', index).takeIf { it >= 0 } ?: text.length
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                append(text.substring(index + 2, end))
            }
            index = end
        } else if (text.startsWith("**", index)) {
            val end = text.indexOf("**", index + 2)
            if (end >= 0) {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                    append(text.substring(index + 2, end))
                }
                index = end + 2
            } else {
                append(text[index])
                index += 1
            }
        } else if (text[index] == '`') {
            val end = text.indexOf('`', index + 1)
            if (end >= 0) {
                withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) {
                    append(text.substring(index + 1, end))
                }
                index = end + 1
            } else {
                append(text[index])
                index += 1
            }
        } else {
            append(text[index])
            index += 1
        }
    }
}

fun remoteRoleLabel(role: String): String = when (role) {
    "user" -> "你"
    "system" -> "系统"
    "reasoning" -> "思考摘要"
    else -> "OpenDrSai"
}
