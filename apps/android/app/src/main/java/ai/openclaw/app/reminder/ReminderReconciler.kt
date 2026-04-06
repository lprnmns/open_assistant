package ai.openclaw.app.reminder

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

private const val REMINDER_CONTEXT_MARKER = "\n\nRecent context:\n"
private const val RECONCILE_EXACT_THRESHOLD_MS = 4 * 60 * 60 * 1000L

internal class ReminderReconciler(
  private val scheduler: ReminderScheduler,
  private val requestCronList: suspend (paramsJson: String) -> String,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  private val json = Json { ignoreUnknownKeys = true }

  suspend fun reconcile(limit: Int = 500) {
    val nowMs = clock()
    val remoteReminders = loadRemoteReminderRequests(nowMs = nowMs, limit = limit)
    val remoteIds = remoteReminders.mapTo(linkedSetOf()) { it.id }
    val localReminders = scheduler.listPending(nowMs)

    localReminders.forEach { reminder ->
      val remoteId = reminder.cronJobId?.takeIf { it.isNotBlank() } ?: reminder.id
      if (remoteId !in remoteIds) {
        scheduler.cancel(reminder.id)
      }
    }

    remoteReminders.forEach(scheduler::schedule)
  }

  private suspend fun loadRemoteReminderRequests(nowMs: Long, limit: Int): List<ReminderScheduleRequest> {
    val response =
      requestCronList(
        """{"limit":$limit,"includeDisabled":false}""",
      )
    val root = parseObject(response) ?: return emptyList()
    val jobs = root["jobs"] as? JsonArray ?: return emptyList()
    return jobs.mapNotNull { job ->
      buildReminderRequest(job = job as? JsonObject ?: return@mapNotNull null, nowMs = nowMs)
    }
  }

  private fun buildReminderRequest(job: JsonObject, nowMs: Long): ReminderScheduleRequest? {
    val id = job.stringField("id") ?: return null
    val schedule = job["schedule"] as? JsonObject ?: return null
    val payload = job["payload"] as? JsonObject ?: return null

    val kind = schedule.stringField("kind")
    val at = schedule.stringField("at")
    val payloadKind = payload.stringField("kind")
    val payloadText = payload.stringField("text")
    if (kind != "at" || at.isNullOrBlank() || payloadKind != "systemEvent" || payloadText.isNullOrBlank()) {
      return null
    }

    val dueAtMs = runCatching { java.time.Instant.parse(at).toEpochMilli() }.getOrNull() ?: return null
    if (dueAtMs <= nowMs) {
      return null
    }

    val title = job.stringField("name") ?: "OpenClaw reminder"
    val body = compactReminderBody(payloadText)
    return ReminderScheduleRequest(
      id = id,
      title = title,
      body = body,
      dueAtMs = dueAtMs,
      precision = if (dueAtMs - nowMs < RECONCILE_EXACT_THRESHOLD_MS) "exact" else "soft",
      priority = "active",
      cronJobId = id,
      createdAtMs = nowMs,
    )
  }

  private fun compactReminderBody(text: String): String {
    val withoutContext = text.substringBefore(REMINDER_CONTEXT_MARKER)
    val compact = withoutContext.replace(Regex("\\s+"), " ").trim()
    return if (compact.isEmpty()) "OpenClaw follow-up" else compact
  }

  private fun parseObject(payloadJson: String): JsonObject? {
    return runCatching { json.parseToJsonElement(payloadJson).jsonObject }.getOrNull()
  }
}

private fun JsonObject.stringField(key: String): String? =
  (this[key] as? JsonPrimitive)?.contentOrNull?.trim()?.ifEmpty { null }
