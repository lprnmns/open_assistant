package ai.openclaw.app.chat

import ai.openclaw.app.ui.chat.isRenderableChatContent
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatControllerMessageIdentityTest {
  @Test
  fun reconcileMessageIdsReusesMatchingIdsAcrossHistoryReload() {
    val previous =
      listOf(
        ChatMessage(
          id = "msg-1",
          role = "assistant",
          content = listOf(ChatMessageContent(type = "text", text = "hello")),
          timestampMs = 1000L,
        ),
        ChatMessage(
          id = "msg-2",
          role = "user",
          content = listOf(ChatMessageContent(type = "text", text = "hi")),
          timestampMs = 2000L,
        ),
      )

    val incoming =
      listOf(
        ChatMessage(
          id = "new-1",
          role = "assistant",
          content = listOf(ChatMessageContent(type = "text", text = "hello")),
          timestampMs = 1000L,
        ),
        ChatMessage(
          id = "new-2",
          role = "user",
          content = listOf(ChatMessageContent(type = "text", text = "hi")),
          timestampMs = 2000L,
        ),
      )

    val reconciled = reconcileMessageIds(previous = previous, incoming = incoming)

    assertEquals(listOf("msg-1", "msg-2"), reconciled.map { it.id })
  }

  @Test
  fun reconcileMessageIdsLeavesNewMessagesUntouched() {
    val previous =
      listOf(
        ChatMessage(
          id = "msg-1",
          role = "assistant",
          content = listOf(ChatMessageContent(type = "text", text = "hello")),
          timestampMs = 1000L,
        ),
      )

    val incoming =
      listOf(
        ChatMessage(
          id = "new-1",
          role = "assistant",
          content = listOf(ChatMessageContent(type = "text", text = "hello")),
          timestampMs = 1000L,
        ),
        ChatMessage(
          id = "new-2",
          role = "assistant",
          content = listOf(ChatMessageContent(type = "text", text = "new reply")),
          timestampMs = 3000L,
        ),
      )

    val reconciled = reconcileMessageIds(previous = previous, incoming = incoming)

    assertEquals("msg-1", reconciled[0].id)
    assertEquals("new-2", reconciled[1].id)
    assertNotEquals(reconciled[0].id, reconciled[1].id)
  }

  @Test
  fun resolveHistoryFieldArrayFallsBackToSingularValue() {
    val json = Json.parseToJsonElement("""{"MediaPath":"C:\\temp\\exam.pdf"}""").jsonObject

    assertEquals(listOf("C:\\temp\\exam.pdf"), resolveHistoryFieldArray(json, "MediaPaths", "MediaPath"))
  }

  @Test
  fun inferHistoryAttachmentTypeDistinguishesPdfAndImages() {
    assertEquals("document", inferHistoryAttachmentType("application/pdf"))
    assertEquals("image", inferHistoryAttachmentType("image/png"))
    assertEquals("file", inferHistoryAttachmentType("application/octet-stream"))
  }

  @Test
  fun extractHistoryFileNameHandlesWindowsAndPosixPaths() {
    assertEquals("exam.pdf", extractHistoryFileName("C:\\temp\\exam.pdf"))
    assertEquals("image.jpg", extractHistoryFileName("/tmp/image.jpg"))
  }

  @Test
  fun resolveHistoryInlineContentsSupportsStringContent() {
    val json = Json.parseToJsonElement("""{"content":"hello from transcript"}""").jsonObject

    assertEquals(
      listOf(ChatMessageContent(type = "text", text = "hello from transcript")),
      resolveHistoryInlineContents(json),
    )
  }

  @Test
  fun resolveHistoryInlineContentsFallsBackToTextField() {
    val json = Json.parseToJsonElement("""{"text":"assistant reply"}""").jsonObject

    assertEquals(
      listOf(ChatMessageContent(type = "text", text = "assistant reply")),
      resolveHistoryInlineContents(json),
    )
  }

  @Test
  fun imageHistoryAttachmentsRemainRenderableWithoutBase64() {
    val imageContent =
      ChatMessageContent(
        type = "image",
        mimeType = "image/png",
        fileName = "photo.png",
        base64 = null,
      )

    assertTrue(isRenderableChatContent(imageContent))
  }

  @Test
  fun emptyImageHistoryAttachmentIsNotRenderable() {
    val imageContent =
      ChatMessageContent(
        type = "image",
        mimeType = null,
        fileName = null,
        base64 = null,
      )

    assertFalse(isRenderableChatContent(imageContent))
  }
}
