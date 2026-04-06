package ai.openclaw.app.chat

import ai.openclaw.app.ui.chat.attachmentLoadErrorMessage
import org.junit.Assert.assertEquals
import org.junit.Test

class AttachmentLoadErrorsTest {
  @Test
  fun mapsOversizedAttachmentToUserFacingMessage() {
    assertEquals(
      "Attachment is too large. PDF limit is 10 MB.",
      attachmentLoadErrorMessage(IllegalStateException("attachment too large")),
    )
  }

  @Test
  fun mapsUnknownFailuresToGenericMessage() {
    assertEquals(
      "Could not attach that file.",
      attachmentLoadErrorMessage(IllegalStateException("boom")),
    )
  }
}
