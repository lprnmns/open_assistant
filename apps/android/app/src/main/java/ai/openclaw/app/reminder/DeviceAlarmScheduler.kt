package ai.openclaw.app.reminder

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.runBlocking

internal interface ReminderAlarmRegistrar {
  fun schedule(dueAtMs: Long, pendingIntent: PendingIntent)

  fun cancel(pendingIntent: PendingIntent)
}

private class AndroidReminderAlarmRegistrar(
  private val alarmManager: AlarmManager,
) : ReminderAlarmRegistrar {
  override fun schedule(dueAtMs: Long, pendingIntent: PendingIntent) {
    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, dueAtMs, pendingIntent)
  }

  override fun cancel(pendingIntent: PendingIntent) {
    alarmManager.cancel(pendingIntent)
  }
}

internal class DeviceAlarmScheduler(
  private val appContext: Context,
  private val database: ReminderDatabase = ReminderDatabaseProvider.get(appContext),
  private val registrar: ReminderAlarmRegistrar =
    AndroidReminderAlarmRegistrar(
      alarmManager = appContext.getSystemService(AlarmManager::class.java),
    ),
) : ReminderScheduler {
  override fun schedule(request: ReminderScheduleRequest) {
    val entity =
      ScheduledReminderEntity(
        id = request.id,
        title = request.title,
        body = request.body,
        dueAtMs = request.dueAtMs,
        precision = request.precision,
        priority = request.priority,
        cronJobId = request.cronJobId,
        createdAtMs = request.createdAtMs,
      )
    runBlocking {
      database.reminderDao().upsert(entity)
    }
    registrar.schedule(
      dueAtMs = request.dueAtMs,
      pendingIntent = buildPendingIntent(request.id),
    )
  }

  override fun cancel(id: String) {
    runBlocking {
      database.reminderDao().deleteById(id)
    }
    registrar.cancel(
      pendingIntent = buildPendingIntent(id),
    )
  }

  override fun listPending(nowMs: Long): List<ScheduledReminderEntity> =
    runBlocking {
      database.reminderDao().getAllPending(nowMs)
    }

  private fun buildPendingIntent(reminderId: String): PendingIntent {
    val intent =
      Intent(appContext, ReminderAlarmReceiver::class.java)
        .setAction(ReminderAlarmReceiver.ActionFire)
        .putExtra(ReminderAlarmReceiver.ExtraReminderId, reminderId)
    return PendingIntent.getBroadcast(
      appContext,
      reminderRequestCode(reminderId),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun reminderRequestCode(reminderId: String): Int = reminderId.hashCode() and 0x7FFFFFFF
}
