package ai.drsai.remote.remote.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val MAX_MARKDOWN_CHARS = 200_000
private const val LINK_TAG = "markdown-link"

sealed interface RemoteMarkdownBlock {
    data class Heading(val level: Int, val text: String) : RemoteMarkdownBlock
    data class Paragraph(val text: String) : RemoteMarkdownBlock
    data class Quote(val lines: List<String>) : RemoteMarkdownBlock
    data class Code(val language: String, val code: String) : RemoteMarkdownBlock
    data class BulletList(val items: List<RemoteMarkdownListItem>) : RemoteMarkdownBlock
    data class OrderedList(val start: Int, val items: List<RemoteMarkdownListItem>) : RemoteMarkdownBlock
    data class Table(val headers: List<String>, val rows: List<List<String>>) : RemoteMarkdownBlock
    data object Rule : RemoteMarkdownBlock
}

data class RemoteMarkdownListItem(val text: String, val checked: Boolean? = null)

/**
 * A bounded, offline GFM parser used by remote transcripts.
 *
 * HTML remains plain text and images are represented as safe labelled links;
 * no WebView, script execution, remote image fetch or HTML interpretation is
 * involved.
 */
fun parseRemoteMarkdown(value: String): List<RemoteMarkdownBlock> {
    val lines = value.take(MAX_MARKDOWN_CHARS).replace("\r\n", "\n").replace('\r', '\n').split('\n')
    val blocks = mutableListOf<RemoteMarkdownBlock>()
    var index = 0
    while (index < lines.size) {
        val line = lines[index]
        if (line.isBlank()) {
            index++
            continue
        }
        val fence = Regex("""^\s*```([\w.+-]*)\s*$""").matchEntire(line)
        if (fence != null) {
            val code = mutableListOf<String>()
            index++
            while (index < lines.size && !Regex("""^\s*```\s*$""").matches(lines[index])) {
                code += lines[index++]
            }
            if (index < lines.size) index++
            blocks += RemoteMarkdownBlock.Code(fence.groupValues[1].ifBlank { "text" }, code.joinToString("\n"))
            continue
        }
        val heading = Regex("""^(#{1,6})\s+(.+?)\s*#*\s*$""").matchEntire(line)
        if (heading != null) {
            blocks += RemoteMarkdownBlock.Heading(heading.groupValues[1].length, heading.groupValues[2])
            index++
            continue
        }
        if (Regex("""^\s{0,3}((\*|-|_)\s*){3,}$""").matches(line)) {
            blocks += RemoteMarkdownBlock.Rule
            index++
            continue
        }
        if (line.trimStart().startsWith(">")) {
            val quote = mutableListOf<String>()
            while (index < lines.size && lines[index].trimStart().startsWith(">")) {
                quote += lines[index].trimStart().removePrefix(">").removePrefix(" ")
                index++
            }
            blocks += RemoteMarkdownBlock.Quote(quote)
            continue
        }
        val bullet = Regex("""^\s*[-+*]\s+(?:\[([ xX])]\s+)?(.+)$""").matchEntire(line)
        if (bullet != null) {
            val items = mutableListOf<RemoteMarkdownListItem>()
            while (index < lines.size) {
                val match = Regex("""^\s*[-+*]\s+(?:\[([ xX])]\s+)?(.+)$""").matchEntire(lines[index]) ?: break
                items += RemoteMarkdownListItem(
                    match.groupValues[2],
                    match.groupValues[1].takeIf(String::isNotEmpty)?.equals("x", ignoreCase = true),
                )
                index++
            }
            blocks += RemoteMarkdownBlock.BulletList(items)
            continue
        }
        val ordered = Regex("""^\s*(\d+)[.)]\s+(.+)$""").matchEntire(line)
        if (ordered != null) {
            val items = mutableListOf<RemoteMarkdownListItem>()
            val start = ordered.groupValues[1].toIntOrNull() ?: 1
            while (index < lines.size) {
                val match = Regex("""^\s*\d+[.)]\s+(.+)$""").matchEntire(lines[index]) ?: break
                items += RemoteMarkdownListItem(match.groupValues[1])
                index++
            }
            blocks += RemoteMarkdownBlock.OrderedList(start, items)
            continue
        }
        if (index + 1 < lines.size && isTableRow(line) && isTableDivider(lines[index + 1])) {
            val headers = splitTableRow(line)
            val rows = mutableListOf<List<String>>()
            index += 2
            while (index < lines.size && isTableRow(lines[index]) && lines[index].isNotBlank()) {
                rows += splitTableRow(lines[index++])
            }
            blocks += RemoteMarkdownBlock.Table(headers, rows)
            continue
        }
        val paragraph = mutableListOf(line)
        index++
        while (index < lines.size && lines[index].isNotBlank() && !startsMarkdownBlock(lines, index)) {
            paragraph += lines[index++]
        }
        blocks += RemoteMarkdownBlock.Paragraph(paragraph.joinToString("\n"))
    }
    return blocks
}

private fun startsMarkdownBlock(lines: List<String>, index: Int): Boolean {
    val line = lines[index]
    return Regex("""^\s*```""").containsMatchIn(line) ||
        Regex("""^#{1,6}\s+""").containsMatchIn(line) ||
        Regex("""^\s{0,3}((\*|-|_)\s*){3,}$""").matches(line) ||
        line.trimStart().startsWith(">") ||
        Regex("""^\s*[-+*]\s+""").containsMatchIn(line) ||
        Regex("""^\s*\d+[.)]\s+""").containsMatchIn(line) ||
        (index + 1 < lines.size && isTableRow(line) && isTableDivider(lines[index + 1]))
}

private fun isTableRow(line: String): Boolean = line.count { it == '|' } >= 1
private fun isTableDivider(line: String): Boolean =
    splitTableRow(line).isNotEmpty() && splitTableRow(line).all { Regex(""":?-{3,}:?""").matches(it.trim()) }

private fun splitTableRow(line: String): List<String> {
    val normalized = line.trim().removePrefix("|").removeSuffix("|")
    val cells = mutableListOf<String>()
    val current = StringBuilder()
    var escaped = false
    normalized.forEach { char ->
        when {
            escaped -> {
                current.append(char)
                escaped = false
            }
            char == '\\' -> escaped = true
            char == '|' -> {
                cells += current.toString().trim()
                current.clear()
            }
            else -> current.append(char)
        }
    }
    cells += current.toString().trim()
    return cells
}

fun remoteMarkdown(value: String): AnnotatedString = remoteMarkdownInline(value.take(MAX_MARKDOWN_CHARS))

fun remoteMarkdownInline(value: String): AnnotatedString = buildAnnotatedString {
    var index = 0
    fun appendStyled(text: String, style: SpanStyle? = null) {
        if (style == null) append(text) else withStyle(style) { append(text) }
    }
    while (index < value.length) {
        val image = Regex("""!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)""").find(value, index)
            ?.takeIf { it.range.first == index }
        val link = Regex("""\[([^\]]+)]\(([^)\s]+)(?:\s+"[^"]*")?\)""").find(value, index)
            ?.takeIf { it.range.first == index }
        when {
            image != null -> {
                val label = image.groupValues[1].ifBlank { "图片" }
                val url = image.groupValues[2]
                val start = length
                append("🖼 $label")
                if (isSafeMarkdownLink(url)) {
                    addStyle(SpanStyle(color = Color(0xFF7651D6), textDecoration = TextDecoration.Underline), start, length)
                    addStringAnnotation(LINK_TAG, url, start, length)
                }
                index = image.range.last + 1
            }
            link != null -> {
                val label = link.groupValues[1]
                val url = link.groupValues[2]
                val start = length
                append(label)
                if (isSafeMarkdownLink(url)) {
                    addStyle(SpanStyle(color = Color(0xFF7651D6), textDecoration = TextDecoration.Underline), start, length)
                    addStringAnnotation(LINK_TAG, url, start, length)
                }
                index = link.range.last + 1
            }
            value.startsWith("**", index) || value.startsWith("__", index) -> {
                val marker = value.substring(index, index + 2)
                val end = value.indexOf(marker, index + 2)
                if (end >= 0) {
                    appendStyled(value.substring(index + 2, end), SpanStyle(fontWeight = FontWeight.Bold))
                    index = end + 2
                } else append(value[index++])
            }
            value.startsWith("~~", index) -> {
                val end = value.indexOf("~~", index + 2)
                if (end >= 0) {
                    appendStyled(value.substring(index + 2, end), SpanStyle(textDecoration = TextDecoration.LineThrough))
                    index = end + 2
                } else append(value[index++])
            }
            value[index] == '`' -> {
                val end = value.indexOf('`', index + 1)
                if (end >= 0) {
                    appendStyled(value.substring(index + 1, end), SpanStyle(fontFamily = FontFamily.Monospace))
                    index = end + 1
                } else append(value[index++])
            }
            value[index] == '*' || value[index] == '_' -> {
                val marker = value[index]
                val end = value.indexOf(marker, index + 1)
                if (end > index + 1) {
                    appendStyled(value.substring(index + 1, end), SpanStyle(fontStyle = FontStyle.Italic))
                    index = end + 1
                } else append(value[index++])
            }
            value[index] == '\\' && index + 1 < value.length &&
                value[index + 1] in "\\`*_{}[]()#+-.!|>" -> {
                append(value[index + 1])
                index += 2
            }
            else -> append(value[index++])
        }
    }
}

fun isSafeMarkdownLink(value: String): Boolean = runCatching {
    val scheme = java.net.URI(value).scheme?.lowercase()
    scheme in setOf("https", "http", "mailto")
}.getOrDefault(false)

@Composable
fun RemoteMarkdownContent(value: String, modifier: Modifier = Modifier) {
    val uriHandler = LocalUriHandler.current
    SelectionContainer(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            parseRemoteMarkdown(value).forEach { block ->
                when (block) {
                    is RemoteMarkdownBlock.Heading -> MarkdownText(
                        block.text,
                        style = when (block.level) {
                            1 -> MaterialTheme.typography.headlineSmall
                            2 -> MaterialTheme.typography.titleLarge
                            3 -> MaterialTheme.typography.titleMedium
                            else -> MaterialTheme.typography.titleSmall
                        }.copy(fontWeight = FontWeight.Bold),
                        onOpenLink = uriHandler::openUri,
                    )
                    is RemoteMarkdownBlock.Paragraph ->
                        MarkdownText(block.text, MaterialTheme.typography.bodyMedium, uriHandler::openUri)
                    is RemoteMarkdownBlock.Quote -> Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        border = BorderStroke(0.dp, Color.Transparent),
                        shape = RoundedCornerShape(0.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row {
                            Surface(color = MaterialTheme.colorScheme.primary, modifier = Modifier.width(4.dp)) {}
                            MarkdownText(
                                block.lines.joinToString("\n"),
                                MaterialTheme.typography.bodyMedium.copy(fontStyle = FontStyle.Italic),
                                uriHandler::openUri,
                                Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            )
                        }
                    }
                    is RemoteMarkdownBlock.Code -> RemoteCodeBlock(block)
                    is RemoteMarkdownBlock.BulletList -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        block.items.forEach { item ->
                            Row {
                                Text(item.checked?.let { if (it) "☑" else "☐" } ?: "•")
                                Spacer(Modifier.width(8.dp))
                                MarkdownText(item.text, MaterialTheme.typography.bodyMedium, uriHandler::openUri)
                            }
                        }
                    }
                    is RemoteMarkdownBlock.OrderedList -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        block.items.forEachIndexed { itemIndex, item ->
                            Row {
                                Text("${block.start + itemIndex}.")
                                Spacer(Modifier.width(8.dp))
                                MarkdownText(item.text, MaterialTheme.typography.bodyMedium, uriHandler::openUri)
                            }
                        }
                    }
                    is RemoteMarkdownBlock.Table -> RemoteMarkdownTable(block, uriHandler::openUri)
                    RemoteMarkdownBlock.Rule -> HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun MarkdownText(
    value: String,
    style: TextStyle,
    onOpenLink: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val annotated = remember(value) { remoteMarkdownInline(value) }
    ClickableText(
        text = annotated,
        style = style.copy(color = MaterialTheme.colorScheme.onSurface),
        modifier = modifier,
        onClick = { offset ->
            annotated.getStringAnnotations(LINK_TAG, offset, offset).firstOrNull()?.item?.let(onOpenLink)
        },
    )
}

@Composable
private fun RemoteCodeBlock(block: RemoteMarkdownBlock.Code) {
    val clipboard = LocalClipboardManager.current
    var copied by remember(block.code) { mutableStateOf(false) }
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(block.language, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 12.dp))
                IconButton(onClick = {
                    clipboard.setText(AnnotatedString(block.code))
                    copied = true
                }) {
                    Icon(if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
                        contentDescription = if (copied) "已复制" else "复制代码")
                }
            }
            if (block.language.equals("diff", ignoreCase = true)) {
                Column(Modifier.horizontalScroll(rememberScrollState()).padding(12.dp)) {
                    block.code.split('\n').forEach { line ->
                        Text(
                            line.ifEmpty { " " },
                            color = when {
                                line.startsWith("+") && !line.startsWith("+++") -> Color(0xFF238636)
                                line.startsWith("-") && !line.startsWith("---") -> MaterialTheme.colorScheme.error
                                line.startsWith("@@") -> MaterialTheme.colorScheme.primary
                                else -> MaterialTheme.colorScheme.onSurface
                            },
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp,
                        )
                    }
                }
            } else {
                Text(
                    block.code,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                    modifier = Modifier.horizontalScroll(rememberScrollState()).padding(12.dp),
                )
            }
        }
    }
}

@Composable
private fun RemoteMarkdownTable(block: RemoteMarkdownBlock.Table, onOpenLink: (String) -> Unit) {
    val columns = maxOf(block.headers.size, block.rows.maxOfOrNull(List<String>::size) ?: 0)
    val clipboard = LocalClipboardManager.current
    var copied by remember(block) { mutableStateOf(false) }
    Surface(
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shape = RoundedCornerShape(8.dp),
    ) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                IconButton(onClick = {
                    val rows = listOf(block.headers) + block.rows
                    clipboard.setText(AnnotatedString(rows.joinToString("\n") { it.joinToString("\t") }))
                    copied = true
                }) {
                    Icon(
                        if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
                        contentDescription = if (copied) "已复制表格" else "复制表格",
                    )
                }
            }
            Column(Modifier.horizontalScroll(rememberScrollState())) {
                @Composable
                fun row(cells: List<String>, header: Boolean) {
                    Row {
                        repeat(columns) { column ->
                            Surface(
                                color = if (header) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent,
                                border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant),
                                modifier = Modifier.width(180.dp),
                            ) {
                                MarkdownText(
                                    cells.getOrElse(column) { "" },
                                    MaterialTheme.typography.bodySmall.copy(
                                        fontWeight = if (header) FontWeight.Bold else FontWeight.Normal,
                                    ),
                                    onOpenLink,
                                    Modifier.padding(10.dp),
                                )
                            }
                        }
                    }
                }
                row(block.headers, true)
                block.rows.forEach { row(it, false) }
            }
        }
    }
}

fun remoteRoleLabel(role: String): String = when (role) {
    "user" -> "你"
    "system" -> "系统"
    "reasoning" -> "思考摘要"
    else -> "OpenDrSai"
}
