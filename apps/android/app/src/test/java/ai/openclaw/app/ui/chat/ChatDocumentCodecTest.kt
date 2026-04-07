package ai.openclaw.app.ui.chat

import ai.openclaw.app.node.NodeHandlerRobolectricTest
import android.net.Uri
import android.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.ConscryptMode
import java.io.File
import java.io.RandomAccessFile

@RunWith(RobolectricTestRunner::class)
@ConscryptMode(ConscryptMode.Mode.OFF)
class ChatDocumentCodecTest : NodeHandlerRobolectricTest() {
  @Test
  fun loadPdfAttachmentEncodesSmallPdf() {
    val file = writeTempFile("exam_schedule.pdf", "%PDF-1.4\nexam schedule\n".toByteArray())

    val attachment = loadPdfAttachment(appContext().contentResolver, Uri.fromFile(file))

    assertEquals("document", attachment.type)
    assertEquals("application/pdf", attachment.mimeType)
    assertEquals("exam_schedule.pdf", attachment.fileName)
    assertNull(attachment.sourceUri)
    assertNotNull(attachment.base64)
    assertArrayEquals(file.readBytes(), Base64.decode(attachment.base64!!, Base64.DEFAULT))
  }

  @Test
  fun loadPdfAttachmentFallsBackToStagedUploadForLargePdf() {
    val file = File(appContext().cacheDir, "large.pdf")
    RandomAccessFile(file, "rw").use { handle ->
      handle.setLength(CHAT_DOCUMENT_MAX_BYTES.toLong() + 1)
    }

    val attachment = loadPdfAttachment(appContext().contentResolver, Uri.fromFile(file))

    assertEquals("document", attachment.type)
    assertEquals("application/pdf", attachment.mimeType)
    assertEquals("large.pdf", attachment.fileName)
    assertNull(attachment.base64)
    assertEquals(Uri.fromFile(file).toString(), attachment.sourceUri)
  }

  private fun writeTempFile(fileName: String, bytes: ByteArray): File {
    val file = File(appContext().cacheDir, fileName)
    file.writeBytes(bytes)
    return file
  }
}
