package ai.drsai.remote.data

import ai.drsai.remote.R
import android.content.Context

enum class AttachmentText { CACHE_EXPIRED, RESULT_EMPTY, RESULT_TOO_LARGE, LOGIN_EXPIRED, CANCELLED, CONNECTION_INTERRUPTED, INVALID_SERVICE_DATA, UNSUPPORTED_FORMAT, FILE_TOO_LARGE, TYPE_MISMATCH, CANNOT_READ, CONTENT_EMPTY, IMAGE_DECODE }
interface AttachmentStrings { fun text(key: AttachmentText): String }
class AndroidAttachmentStrings(private val context: Context) : AttachmentStrings {
    override fun text(key: AttachmentText): String = context.getString(when (key) {
        AttachmentText.CACHE_EXPIRED -> R.string.attachment_cache_expired
        AttachmentText.RESULT_EMPTY -> R.string.attachment_result_empty
        AttachmentText.RESULT_TOO_LARGE -> R.string.attachment_result_too_large
        AttachmentText.LOGIN_EXPIRED -> R.string.platform_login_expired
        AttachmentText.CANCELLED -> R.string.attachment_task_cancelled
        AttachmentText.CONNECTION_INTERRUPTED -> R.string.attachment_connection_interrupted
        AttachmentText.INVALID_SERVICE_DATA -> R.string.attachment_invalid_service_data
        AttachmentText.UNSUPPORTED_FORMAT -> R.string.attachment_unsupported_format
        AttachmentText.FILE_TOO_LARGE -> R.string.attachment_file_too_large
        AttachmentText.TYPE_MISMATCH -> R.string.attachment_type_mismatch
        AttachmentText.CANNOT_READ -> R.string.attachment_cannot_read
        AttachmentText.CONTENT_EMPTY -> R.string.attachment_content_empty
        AttachmentText.IMAGE_DECODE -> R.string.attachment_image_decode
    })
}
object EnglishAttachmentStrings : AttachmentStrings {
    override fun text(key: AttachmentText): String = when (key) {
        AttachmentText.CACHE_EXPIRED -> "The attachment cache expired"
        AttachmentText.RESULT_EMPTY -> "The result file is empty"
        AttachmentText.RESULT_TOO_LARGE -> "The result file exceeds the 10 MB limit"
        AttachmentText.LOGIN_EXPIRED -> "Your HAI sign-in expired; sign in again"
        AttachmentText.CANCELLED -> "The attachment task was cancelled"
        AttachmentText.CONNECTION_INTERRUPTED -> "The attachment upload connection was interrupted"
        AttachmentText.INVALID_SERVICE_DATA -> "The attachment service returned invalid data"
        AttachmentText.UNSUPPORTED_FORMAT -> "Unsupported attachment format"
        AttachmentText.FILE_TOO_LARGE -> "Each attachment must be no larger than 10 MB"
        AttachmentText.TYPE_MISMATCH -> "Attachment content does not match its file type"
        AttachmentText.CANNOT_READ -> "Could not read the attachment"
        AttachmentText.CONTENT_EMPTY -> "The attachment is empty"
        AttachmentText.IMAGE_DECODE -> "Could not decode the image"
    }
}
