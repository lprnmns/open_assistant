package ai.openclaw.app.reminder

import android.content.Context
import ai.openclaw.app.gateway.GatewaySession
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

class ReminderHandler internal constructor(
  private val scheduler: ReminderScheduler,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  constructor(appContext: Context) : this(
    scheduler = DeviceAlarmScheduler(appContext = appContext),
    clock = System::currentTimeMillis,
  )

  fun handleReminderSchedule(paramsJson: String?): GatewaySession.InvokeResult {
    val params = parseParamsObject(paramsJson)
      ?: return GatewaySession.InvokeResult.error(
        code = "INVALID_REQUEST",
        message = "INVALID_REQUEST: expected JSON object",
      )
    val id = stringField(params, "id")
      ?: return invalidRequest("INVALID_REQUEST: id required")
    val title = stringField(params, "title")
      ?: return invalidRequest("INVALID_REQUEST: title required")
    val body = stringField(params, "body")
      ?: return invalidRequest("INVALID_REQUEST: body required")
    val dueAtMs = (params["dueAtMs"] as? JsonPrimitive)?.longOrNull
      ?: return invalidRequest("INVALID_REQUEST: dueAtMs required")
    if (dueAtMs <= 0) {
      return invalidRequest("INVALID_REQUEST: dueAtMs must be positive")
    }
    val normalizedPrecision =
      stringField(params, "precision")
        ?.lowercase()
        ?.takeIf { it in setOf("soft", "exact") }
        ?: "soft"
    val priority = stringField(params, "priority")
    val cronJobId = stringField(params, "cronJobId")
    val createdAtMs = (params["createdAtMs"] as? JsonPrimitive)?.longOrNull ?: clock()

    return try {
      scheduler.schedule(
        ReminderScheduleRequest(
          id = id,
          title = title,
          body = body,
          dueAtMs = dueAtMs,
          precision = normalizedPrecision,
          priority = priority,
          cronJobId = cronJobId,
          createdAtMs = createdAtMs,
        ),
      )
      GatewaySession.InvokeResult.ok(null)
    } catch (err: Throwable) {
      GatewaySession.InvokeResult.error(
        code = "UNAVAILABLE",
        message = "REMINDER_SCHEDULE_FAILED: ${err.message ?: "schedule failed"}",
      )
    }
  }

  fun handleReminderCancel(paramsJson: String?): GatewaySession.InvokeResult {
    val params = parseParamsObject(paramsJson)
      ?: return invalidRequest("INVALID_REQUEST: expected JSON object")
    val id = stringField(params, "id")
      ?: return invalidRequest("INVALID_REQUEST: id required")
    return try {
      scheduler.cancel(id)
      GatewaySession.InvokeResult.ok(null)
    } catch (err: Throwable) {
      GatewaySession.InvokeResult.error(
        code = "UNAVAILABLE",
        message = "REMINDER_CANCEL_FAILED: ${err.message ?: "cancel failed"}",
      )
    }
  }

  fun handleReminderList(paramsJson: String?): GatewaySession.InvokeResult {
    val params = parseParamsObject(paramsJson)
    val nowMs = (params?.get("nowMs") as? JsonPrimitive)?.longOrNull ?: clock()
    return try {
      val reminders = scheduler.listPending(nowMs)
      val payload =
        buildJsonObject {
          put(
            "reminders",
            buildJsonArray {
              reminders.forEach { reminder ->
                add(
                  buildJsonObject {
                    put("id", JsonPrimitive(reminder.id))
                    put("title", JsonPrimitive(reminder.title))
                    put("body", JsonPrimitive(reminder.body))
                    put("dueAtMs", JsonPrimitive(reminder.dueAtMs))
                    put("precision", JsonPrimitive(reminder.precision))
                    reminder.priority?.let { put("priority", JsonPrimitive(it)) }
                    reminder.cronJobId?.let { put("cronJobId", JsonPrimitive(it)) }
                    put("createdAtMs", JsonPrimitive(reminder.createdAtMs))
                  },
                )
              }
            },
          )
        }
      GatewaySession.InvokeResult.ok(payload.toString())
    } catch (err: Throwable) {
      GatewaySession.InvokeResult.error(
        code = "UNAVAILABLE",
        message = "REMINDER_LIST_FAILED: ${err.message ?: "list failed"}",
      )
    }
  }

  private fun invalidRequest(message: String): GatewaySession.InvokeResult =
    GatewaySession.InvokeResult.error(
      code = "INVALID_REQUEST",
      message = message,
    )

  private fun stringField(params: JsonObject, key: String): String? =
    (params[key] as? JsonPrimitive)?.contentOrNull?.trim()?.ifEmpty { null }

  private fun parseParamsObject(paramsJson: String?): JsonObject? {
    if (paramsJson.isNullOrBlank()) return null
    return try {
      Json.parseToJsonElement(paramsJson).jsonObject
    } catch (_: Throwable) {
      null
    }
  }

  companion object {
    internal fun forTesting(
      scheduler: ReminderScheduler,
      clock: () -> Long = System::currentTimeMillis,
    ): ReminderHandler = ReminderHandler(scheduler = scheduler, clock = clock)
  }
}
