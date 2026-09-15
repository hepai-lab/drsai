package ai.drsai.remote.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

data class LocalizedText(@StringRes val resourceId: Int, val arguments: List<Any> = emptyList()) {
    constructor(@StringRes resourceId: Int, vararg arguments: Any) : this(resourceId, arguments.toList())
}

@Composable
fun LocalizedText.resolve(): String = stringResource(resourceId, *arguments.toTypedArray())
