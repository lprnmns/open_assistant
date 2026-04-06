package ai.openclaw.app.ui.chat

import android.net.Uri

internal data class PendingChatAttachment(
  val id: String,
  val type: String,
  val fileName: String,
  val mimeType: String,
  val base64: String,
)

internal fun buildPendingAttachmentId(uri: Uri): String = "${uri}#${System.currentTimeMillis()}"
