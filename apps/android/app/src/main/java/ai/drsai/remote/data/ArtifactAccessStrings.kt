package ai.drsai.remote.data

import ai.drsai.remote.R
import android.content.Context

enum class ArtifactAccessText { DIGEST_TITLE, DIGEST_DETAIL, SIZE_TITLE, SIZE_DETAIL, EXPIRED_TITLE, EXPIRED_DETAIL, INACCESSIBLE_TITLE, INACCESSIBLE_DETAIL, UNKNOWN_TITLE, UNKNOWN_DETAIL }
fun interface ArtifactAccessStrings { fun text(key: ArtifactAccessText, vararg arguments: Any): String }
class AndroidArtifactAccessStrings(private val context: Context) : ArtifactAccessStrings {
    override fun text(key: ArtifactAccessText, vararg arguments: Any): String = context.getString(when (key) {
        ArtifactAccessText.DIGEST_TITLE -> R.string.artifact_digest_title
        ArtifactAccessText.DIGEST_DETAIL -> R.string.artifact_digest_detail
        ArtifactAccessText.SIZE_TITLE -> R.string.artifact_size_title
        ArtifactAccessText.SIZE_DETAIL -> R.string.artifact_size_detail
        ArtifactAccessText.EXPIRED_TITLE -> R.string.artifact_expired_title
        ArtifactAccessText.EXPIRED_DETAIL -> R.string.artifact_expired_detail
        ArtifactAccessText.INACCESSIBLE_TITLE -> R.string.artifact_inaccessible_title
        ArtifactAccessText.INACCESSIBLE_DETAIL -> R.string.artifact_inaccessible_detail
        ArtifactAccessText.UNKNOWN_TITLE -> R.string.artifact_unknown_title
        ArtifactAccessText.UNKNOWN_DETAIL -> R.string.artifact_unknown_detail
    }, *arguments)
}
object EnglishArtifactAccessStrings : ArtifactAccessStrings {
    override fun text(key: ArtifactAccessText, vararg arguments: Any): String = when (key) {
        ArtifactAccessText.DIGEST_TITLE -> "Integrity check failed"
        ArtifactAccessText.DIGEST_DETAIL -> "The file failed its integrity check, so opening or sharing was blocked."
        ArtifactAccessText.SIZE_TITLE -> "File size is unsafe"
        ArtifactAccessText.SIZE_DETAIL -> "This result cannot be opened safely. Generate a smaller version."
        ArtifactAccessText.EXPIRED_TITLE -> "Result expired"
        ArtifactAccessText.EXPIRED_DETAIL -> "The local content is no longer available. Generate it again."
        ArtifactAccessText.INACCESSIBLE_TITLE -> "Result is inaccessible"
        ArtifactAccessText.INACCESSIBLE_DETAIL -> "The result is outside app-authorized secure storage."
        ArtifactAccessText.UNKNOWN_TITLE -> "Could not open result"
        ArtifactAccessText.UNKNOWN_DETAIL -> "Pre-open validation failed (${arguments.first()})."
    }
}
