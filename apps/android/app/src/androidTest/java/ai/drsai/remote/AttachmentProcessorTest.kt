package ai.drsai.remote

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.AttachmentProcessor
import ai.drsai.remote.data.AttachmentStatus
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

@RunWith(AndroidJUnit4::class)
class AttachmentProcessorTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val processor = AttachmentProcessor(context)

    @Test fun copies_utf8_text_to_private_cache_and_computes_hash() = runBlocking {
        val source = File(processor.cameraDirectory, "notes.txt").apply { writeText("真实内容", Charsets.UTF_8) }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", source)
        val draft = processor.prepare(uri)
        assertEquals("notes.txt", draft.name)
        assertEquals("text/plain", draft.mimeType)
        assertEquals(AttachmentStatus.READY, draft.status)
        assertTrue(draft.sha256.matches(Regex("[a-f0-9]{64}")))
        assertEquals("真实内容", File(draft.localPath).readText())
        processor.delete(draft)
        source.delete()
        Unit
    }

    @Test fun normalizes_large_image_and_creates_thumbnail() = runBlocking {
        val source = File(processor.cameraDirectory, "wide.jpg")
        val bitmap = Bitmap.createBitmap(5000, 20, Bitmap.Config.ARGB_8888)
        FileOutputStream(source).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        bitmap.recycle()
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", source)
        val draft = processor.prepare(uri)
        val normalized = BitmapFactory.decodeFile(draft.localPath)
        assertTrue(normalized.width <= 4096)
        assertTrue(File(requireNotNull(draft.thumbnailPath)).isFile)
        assertEquals("image/jpeg", draft.mimeType)
        normalized.recycle()
        processor.delete(draft)
        source.delete()
        Unit
    }

    @Test fun rejects_spoofed_image_and_cleans_old_orphans() = runBlocking {
        val source = File(processor.cameraDirectory, "fake.png").apply { writeText("not png") }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", source)
        val error = runCatching { processor.prepare(uri) }.exceptionOrNull()
        assertTrue(error is ApiException)
        source.setLastModified(1)
        processor.cleanupOrphans(olderThanMs = 1)
        assertFalse(source.exists())
    }

    @Test fun cleanupEvictsOldestUnpinnedFilesToMeetTheHardByteBudget() {
        val old = File(processor.cameraDirectory, "budget-old.bin").apply { writeBytes(ByteArray(8)); setLastModified(1) }
        val kept = File(processor.cameraDirectory, "budget-kept.bin").apply { writeBytes(ByteArray(8)); setLastModified(2) }
        processor.cleanupOrphans(
            keepPaths = setOf(kept.absolutePath),
            olderThanMs = Long.MAX_VALUE,
            maxCacheBytes = 8,
        )
        assertFalse(old.exists())
        assertTrue(kept.exists())
        kept.delete()
    }
}
