package ai.openclaw.app.ui.chat

import android.content.ContentResolver
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.InputStream

internal const val CHAT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024
internal const val CHAT_DOCUMENT_STAGED_UPLOAD_MAX_BYTES = 50 * 1024 * 1024

internal fun loadPdfAttachment(resolver: ContentResolver, uri: Uri): PendingChatAttachment {
  val fileName = normalizeDocumentFileName(extractAttachmentLeafName(uri.lastPathSegment ?: "document.pdf"))
  val attachmentId = buildPendingAttachmentId(uri)
  val input = resolver.openInputStream(uri) ?: throw IllegalStateException("unsupported attachment")
  val inlineBytes =
    input.use { stream ->
      readAttachmentBytesUpToLimitOrNull(stream, CHAT_DOCUMENT_MAX_BYTES)
    }
  return if (inlineBytes != null) {
    if (inlineBytes.isEmpty()) {
      throw IllegalStateException("unsupported attachment")
    }
    PendingChatAttachment(
      id = attachmentId,
      type = "document",
      fileName = fileName,
      mimeType = "application/pdf",
      base64 = Base64.encodeToString(inlineBytes, Base64.NO_WRAP),
    )
  } else {
    PendingChatAttachment(
      id = attachmentId,
      type = "document",
      fileName = fileName,
      mimeType = "application/pdf",
      sourceUri = uri.toString(),
    )
  }
}

internal fun normalizeDocumentFileName(raw: String): String {
  val trimmed = raw.trim()
  if (trimmed.isEmpty()) return "document.pdf"
  return if (trimmed.contains('.')) trimmed else "$trimmed.pdf"
}

private fun readAttachmentBytesWithinLimit(
  input: InputStream,
  maxBytes: Int,
): ByteArray {
  val output = ByteArrayOutputStream()
  val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
  var totalBytes = 0
  while (true) {
    val read = input.read(buffer)
    if (read < 0) break
    totalBytes += read
    if (totalBytes > maxBytes) {
      throw IllegalStateException("attachment too large")
    }
    output.write(buffer, 0, read)
  }
  return output.toByteArray()
}

internal fun readAttachmentBytesForUpload(
  resolver: ContentResolver,
  uri: Uri,
  maxBytes: Int,
): ByteArray {
  val bytes =
    resolver.openInputStream(uri)?.use { input -> readAttachmentBytesWithinLimit(input, maxBytes) }
      ?: throw IllegalStateException("unsupported attachment")
  if (bytes.isEmpty()) {
    throw IllegalStateException("unsupported attachment")
  }
  return bytes
}

private fun readAttachmentBytesUpToLimitOrNull(
  input: InputStream,
  maxBytes: Int,
): ByteArray? {
  val output = ByteArrayOutputStream()
  val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
  var totalBytes = 0
  while (true) {
    val read = input.read(buffer)
    if (read < 0) break
    totalBytes += read
    if (totalBytes > maxBytes) {
      return null
    }
    output.write(buffer, 0, read)
  }
  return output.toByteArray()
}
