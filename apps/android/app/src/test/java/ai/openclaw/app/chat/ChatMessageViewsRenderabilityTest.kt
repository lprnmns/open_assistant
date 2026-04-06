package ai.openclaw.app.chat

import ai.openclaw.app.ui.chat.isRenderableChatContent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatMessageViewsRenderabilityTest {
  @Test
  fun keepsPdfAttachmentsRenderableWithoutBase64Preview() {
    val content =
      ChatMessageContent(
        type = "document",
        mimeType = "application/pdf",
        fileName = "exam.pdf",
        base64 = null,
      )

    assertTrue(isRenderableChatContent(content))
  }

  @Test
  fun rejectsEmptyNonTextAttachments() {
    val content =
      ChatMessageContent(
        type = "document",
        mimeType = null,
        fileName = null,
        base64 = null,
      )

    assertFalse(isRenderableChatContent(content))
  }
}
