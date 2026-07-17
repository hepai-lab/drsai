package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteFileNode
import ai.drsai.remote.remote.ui.PreviewKind
import ai.drsai.remote.remote.ui.buildFilePreview
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceFilePreviewTest {
    @Test fun `preview classifies bounded text image and binary projections`() {
        val text = buildFilePreview(node("notes.md"), "hello".toByteArray(), truncated = true)
        assertEquals(PreviewKind.TEXT, text.kind)
        assertEquals("hello", text.text)
        assertTrue(text.truncated)

        assertEquals(PreviewKind.IMAGE, buildFilePreview(node("image.png"), byteArrayOf(1), false).kind)
        assertEquals(PreviewKind.BINARY, buildFilePreview(node("archive.bin"), byteArrayOf(0), false).kind)
        assertEquals(PreviewKind.UNSUPPORTED, buildFilePreview(node("document.pdf"), byteArrayOf(1), false).kind)
    }

    private fun node(path: String) = RemoteFileNode(path, path, "file", 5, null, null)
}
