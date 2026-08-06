package ai.drsai.remote.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import ai.drsai.remote.data.User
import ai.drsai.remote.data.normalizeOidcAvatarUrl
import ai.drsai.remote.data.userAvatarInitials
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

private const val MAX_AVATAR_BYTES = 2 * 1024 * 1024
private const val MAX_AVATAR_EDGE = 2_048
private const val TARGET_AVATAR_EDGE = 512

@Composable
internal fun UserAvatar(user: User?, modifier: Modifier = Modifier) {
    val avatarUrl = normalizeOidcAvatarUrl(user?.avatarUrl)
    val bitmap by produceState<Bitmap?>(initialValue = null, avatarUrl) {
        value = avatarUrl?.let { AvatarBitmapLoader.load(it) }
    }
    Surface(
        modifier = modifier.testTag("oidc-user-avatar"),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (bitmap != null) {
                Image(
                    bitmap = bitmap!!.asImageBitmap(),
                    contentDescription = "用户头像",
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            } else {
                val initials = user?.name?.let(::userAvatarInitials).orEmpty()
                if (initials.isNotEmpty()) Text(initials, style = MaterialTheme.typography.labelMedium)
                else Icon(Icons.Default.AccountCircle, "默认用户头像", Modifier.fillMaxSize())
            }
        }
    }
}

private object AvatarBitmapLoader {
    private val cache = LruCache<String, Bitmap>(16)
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(false)
        .build()

    suspend fun load(url: String): Bitmap? = withContext(Dispatchers.IO) {
        cache.get(url)?.let { return@withContext it }
        runCatching {
            http.newCall(Request.Builder().url(url).header("Accept", "image/*").get().build()).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val body = response.body ?: return@use null
                val declaredLength = body.contentLength()
                if (declaredLength > MAX_AVATAR_BYTES) return@use null
                val bytes = body.byteStream().use { it.readNBytes(MAX_AVATAR_BYTES + 1) }
                if (bytes.size > MAX_AVATAR_BYTES) return@use null
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                if (bounds.outWidth !in 1..MAX_AVATAR_EDGE || bounds.outHeight !in 1..MAX_AVATAR_EDGE) return@use null
                var sample = 1
                while (bounds.outWidth / sample > TARGET_AVATAR_EDGE || bounds.outHeight / sample > TARGET_AVATAR_EDGE) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                    ?.also { cache.put(url, it) }
            }
        }.getOrNull()
    }
}
