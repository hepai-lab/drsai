package ai.drsai.remote.remote.ui

import android.content.res.Configuration
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration

enum class RemoteUiLanguage { ZH, EN }

fun remoteUiLanguage(languageTag: String?): RemoteUiLanguage =
    if (languageTag?.lowercase()?.startsWith("zh") == true) RemoteUiLanguage.ZH else RemoteUiLanguage.EN

@Composable
fun currentRemoteUiLanguage(configuration: Configuration = LocalConfiguration.current): RemoteUiLanguage =
    remoteUiLanguage(configuration.locales.get(0)?.toLanguageTag())
