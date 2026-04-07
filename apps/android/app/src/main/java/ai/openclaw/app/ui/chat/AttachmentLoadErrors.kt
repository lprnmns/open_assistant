package ai.openclaw.app.ui.chat

internal fun attachmentLoadErrorMessage(error: Throwable): String {
  return when (error.message?.trim()) {
    "attachment too large" -> "Attachment is too large. PDF limit is 50 MB."
    "unsupported attachment" -> "Could not read that attachment."
    "upload auth unavailable" -> "This connection cannot upload large PDFs yet."
    else -> "Could not attach that file."
  }
}
