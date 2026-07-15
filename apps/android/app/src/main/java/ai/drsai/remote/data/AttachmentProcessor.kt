package ai.drsai.remote.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.provider.OpenableColumns
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID

const val MAX_ATTACHMENT_BYTES = 10L * 1024 * 1024
const val MAX_ATTACHMENT_TOTAL_BYTES = 25L * 1024 * 1024
const val MAX_ATTACHMENTS = 5
private const val MAX_IMAGE_DIMENSION = 4096
private const val THUMBNAIL_DIMENSION = 256

object AttachmentPolicy {
    val supportedExtensions = setOf("jpg", "jpeg", "png", "webp", "txt", "md", "csv", "json", "xml", "yaml", "yml", "log", "pdf")
    val acceptedDocumentMimeTypes = arrayOf(
        "text/plain", "text/markdown", "text/csv", "application/json", "application/xml",
        "text/xml", "application/yaml", "text/yaml", "application/pdf",
    )

    fun sanitizeName(raw: String): String {
        val leaf = raw.replace('\\', '/').substringAfterLast('/').replace(Regex("[\\r\\n]"), "")
        return leaf.replace(Regex("[^\\p{L}\\p{N}._() -]"), "_").trim().trim('.', ' ').take(200)
            .ifBlank { "attachment" }
    }

    fun extension(name: String) = name.substringAfterLast('.', "").lowercase()

    fun validateSignature(extension: String, head: ByteArray): Boolean = when (extension) {
        "jpg", "jpeg" -> head.size >= 3 && head[0] == 0xff.toByte() && head[1] == 0xd8.toByte() && head[2] == 0xff.toByte()
        "png" -> head.take(8).toByteArray().contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
        "webp" -> head.size >= 12 && String(head.copyOfRange(0, 4)) == "RIFF" && String(head.copyOfRange(8, 12)) == "WEBP"
        "pdf" -> head.size >= 5 && String(head.copyOfRange(0, 5)) == "%PDF-"
        "txt", "md", "csv", "json", "xml", "yaml", "yml", "log" -> runCatching { head.toString(Charsets.UTF_8) }.isSuccess && !head.contains(0)
        else -> false
    }
}

class AttachmentProcessor(private val context: Context) {
    private val root = File(context.cacheDir, "attachments")
    private val prepared = File(root, "prepared")
    private val thumbnails = File(root, "thumbnails")
    val cameraDirectory = File(root, "camera")

    init {
        prepared.mkdirs()
        thumbnails.mkdirs()
        cameraDirectory.mkdirs()
    }

    fun newCameraFile(): File = File(cameraDirectory, "camera-${UUID.randomUUID()}.jpg")

    suspend fun prepare(uri: Uri, fallbackName: String? = null): AttachmentDraft = withContext(Dispatchers.IO) {
        val metadata = queryMetadata(uri)
        val originalName = AttachmentPolicy.sanitizeName(metadata.first ?: fallbackName ?: "attachment")
        val extension = AttachmentPolicy.extension(originalName)
        if (extension !in AttachmentPolicy.supportedExtensions) throw ApiException(400, "不支持的附件格式", false)
        if (metadata.second != null && metadata.second!! > MAX_ATTACHMENT_BYTES) throw ApiException(413, "单个附件不能超过 10 MB", false)
        val draftId = UUID.randomUUID().toString()
        val source = File(prepared, "$draftId.$extension")
        copyLimited(uri, source)
        val head = FileInputStream(source).use { input -> ByteArray(512).let { bytes -> bytes.copyOf(input.read(bytes).coerceAtLeast(0)) } }
        if (!AttachmentPolicy.validateSignature(extension, head)) {
            source.delete()
            throw ApiException(422, "附件内容与文件类型不一致", false)
        }
        val declaredMime = context.contentResolver.getType(uri)
        if (extension in setOf("jpg", "jpeg", "png", "webp")) {
            prepareImage(draftId, originalName, source)
        } else {
            val mime = when (extension) {
                "pdf" -> "application/pdf"
                "json" -> "application/json"
                "xml" -> "application/xml"
                "yaml", "yml" -> "application/yaml"
                else -> declaredMime?.takeIf { it.startsWith("text/") } ?: "text/plain"
            }
            AttachmentDraft(
                id = draftId, name = originalName, mimeType = mime, size = source.length(), kind = "file",
                localPath = source.absolutePath, sha256 = sha256(source), status = AttachmentStatus.READY,
            )
        }
    }

    fun delete(draft: AttachmentDraft) {
        File(draft.localPath).takeIf(File::exists)?.delete()
        draft.thumbnailPath?.let(::File)?.takeIf(File::exists)?.delete()
    }

    fun cleanupOrphans(keepPaths: Set<String> = emptySet(), olderThanMs: Long = 24 * 60 * 60 * 1000L) {
        val threshold = System.currentTimeMillis() - olderThanMs
        listOf(prepared, thumbnails, cameraDirectory).flatMap { it.listFiles()?.toList().orEmpty() }.forEach { file ->
            if (file.absolutePath !in keepPaths && file.lastModified() < threshold) file.delete()
        }
    }

    private fun queryMetadata(uri: Uri): Pair<String?, Long?> {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                return (if (nameIndex >= 0) cursor.getString(nameIndex) else null) to
                    (if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) cursor.getLong(sizeIndex) else null)
            }
        }
        return null to null
    }

    private fun copyLimited(uri: Uri, target: File) {
        val input = context.contentResolver.openInputStream(uri) ?: throw ApiException(400, "无法读取附件", false)
        var total = 0L
        try {
            input.use { source ->
                FileOutputStream(target).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = source.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > MAX_ATTACHMENT_BYTES) throw ApiException(413, "单个附件不能超过 10 MB", false)
                        output.write(buffer, 0, count)
                    }
                }
            }
            if (total == 0L) throw ApiException(422, "附件内容为空", false)
        } catch (error: Throwable) {
            target.delete()
            throw error
        }
    }

    private fun prepareImage(id: String, originalName: String, source: File): AttachmentDraft {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw ApiException(422, "无法解码图片", false)
        var sample = 1
        while (bounds.outWidth / sample > MAX_IMAGE_DIMENSION * 2 || bounds.outHeight / sample > MAX_IMAGE_DIMENSION * 2) sample *= 2
        val bitmap = BitmapFactory.decodeFile(source.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw ApiException(422, "无法解码图片", false)
        val rotated = rotate(bitmap, source)
        val scale = minOf(1f, MAX_IMAGE_DIMENSION.toFloat() / maxOf(rotated.width, rotated.height))
        val normalized = if (scale < 1f) Bitmap.createScaledBitmap(rotated, (rotated.width * scale).toInt(), (rotated.height * scale).toInt(), true) else rotated
        val output = File(prepared, "$id.jpg")
        FileOutputStream(output).use { normalized.compress(Bitmap.CompressFormat.JPEG, 88, it) }
        val thumbScale = minOf(1f, THUMBNAIL_DIMENSION.toFloat() / maxOf(normalized.width, normalized.height))
        val thumb = Bitmap.createScaledBitmap(normalized, maxOf(1, (normalized.width * thumbScale).toInt()), maxOf(1, (normalized.height * thumbScale).toInt()), true)
        val thumbnail = File(thumbnails, "$id.jpg")
        FileOutputStream(thumbnail).use { thumb.compress(Bitmap.CompressFormat.JPEG, 80, it) }
        if (thumb !== normalized) thumb.recycle()
        if (normalized !== rotated) normalized.recycle()
        if (rotated !== bitmap) rotated.recycle()
        bitmap.recycle()
        if (source.absolutePath != output.absolutePath) source.delete()
        val normalizedName = originalName.substringBeforeLast('.', originalName) + ".jpg"
        return AttachmentDraft(
            id = id, name = normalizedName, mimeType = "image/jpeg", size = output.length(), kind = "image",
            localPath = output.absolutePath, thumbnailPath = thumbnail.absolutePath, sha256 = sha256(output),
            status = AttachmentStatus.READY,
        )
    }

    private fun rotate(bitmap: Bitmap, source: File): Bitmap {
        val orientation = runCatching { ExifInterface(source).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val degrees = when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        return if (degrees == 0f) bitmap else Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees) }, true)
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
