package ai.openclaw.app.ui.chat

internal fun attachmentLoadErrorMessage(error: Throwable): String {
  return when (error.message?.trim()) {
    "attachment too large" -> "Attachment is too large. PDF limit is 10 MB."
    "unsupported attachment" -> "Could not read that attachment."
    else -> "Could not attach that file."
  }
}
