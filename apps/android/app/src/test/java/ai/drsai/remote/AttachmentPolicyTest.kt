package ai.drsai.remote

import ai.drsai.remote.data.AttachmentPolicy
import ai.drsai.remote.data.MAX_ATTACHMENTS
import ai.drsai.remote.data.MAX_ATTACHMENT_BYTES
import ai.drsai.remote.data.MAX_ATTACHMENT_TOTAL_BYTES
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AttachmentPolicyTest {
    @Test fun sanitizes_names_and_accepts_only_supported_extensions() {
        assertEquals("报告 1.txt", AttachmentPolicy.sanitizeName("../../报告 1.txt"))
        assertEquals("pdf", AttachmentPolicy.extension("report.PDF"))
        assertTrue("pdf" in AttachmentPolicy.supportedExtensions)
        assertFalse("apk" in AttachmentPolicy.supportedExtensions)
    }

    @Test fun validates_image_pdf_and_text_signatures() {
        assertTrue(AttachmentPolicy.validateSignature("jpg", byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte())))
        assertTrue(AttachmentPolicy.validateSignature("png", byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)))
        assertTrue(AttachmentPolicy.validateSignature("pdf", "%PDF-1.7".encodeToByteArray()))
        assertTrue(AttachmentPolicy.validateSignature("txt", "hello".encodeToByteArray()))
        assertFalse(AttachmentPolicy.validateSignature("png", "fake".encodeToByteArray()))
        assertFalse(AttachmentPolicy.validateSignature("txt", byteArrayOf(0, 1, 2)))
    }

    @Test fun fixed_limits_match_v146_contract() {
        assertEquals(5, MAX_ATTACHMENTS)
        assertEquals(10L * 1024 * 1024, MAX_ATTACHMENT_BYTES)
        assertEquals(25L * 1024 * 1024, MAX_ATTACHMENT_TOTAL_BYTES)
    }
}
