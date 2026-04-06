package ai.openclaw.app.reminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import ai.openclaw.app.node.SystemHandler
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

class ReminderAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ActionFire) return
    val reminderId = intent.getStringExtra(ExtraReminderId)?.trim().orEmpty()
    if (reminderId.isEmpty()) return

    val appContext = context.applicationContext
    val reminder =
      runBlocking {
        ReminderDatabaseProvider.get(appContext).reminderDao().getById(reminderId)
      } ?: return

    val payload =
      buildJsonObject {
        put("title", JsonPrimitive(reminder.title))
        put("body", JsonPrimitive(reminder.body))
        reminder.priority?.let { put("priority", JsonPrimitive(it)) }
      }
    SystemHandler(appContext).handleSystemNotify(payload.toString())
    runBlocking {
      ReminderDatabaseProvider.get(appContext).reminderDao().deleteById(reminderId)
    }
  }

  companion object {
    const val ActionFire: String = "ai.openclaw.app.reminder.ACTION_FIRE"
    const val ExtraReminderId: String = "reminderId"
  }
}
