package ai.openclaw.app.reminder

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.runBlocking

internal interface ReminderAlarmRegistrar {
  fun canScheduleExactAlarms(): Boolean

  fun scheduleExact(id: String, dueAtMs: Long, pendingIntent: PendingIntent)

  fun scheduleSoft(id: String, dueAtMs: Long, pendingIntent: PendingIntent)

  fun cancel(id: String, pendingIntent: PendingIntent)
}

private class AndroidReminderAlarmRegistrar(
  private val alarmManager: AlarmManager,
) : ReminderAlarmRegistrar {
  override fun canScheduleExactAlarms(): Boolean = alarmManager.canScheduleExactAlarms()

  override fun scheduleExact(id: String, dueAtMs: Long, pendingIntent: PendingIntent) {
    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, dueAtMs, pendingIntent)
  }

  override fun scheduleSoft(id: String, dueAtMs: Long, pendingIntent: PendingIntent) {
    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, dueAtMs, pendingIntent)
  }

  override fun cancel(id: String, pendingIntent: PendingIntent) {
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
    registerAlarm(entity)
  }

  override fun cancel(id: String) {
    runBlocking {
      database.reminderDao().deleteById(id)
    }
    registrar.cancel(
      id = id,
      pendingIntent = buildPendingIntent(id),
    )
  }

  override fun listPending(nowMs: Long): List<ScheduledReminderEntity> =
    runBlocking {
      database.reminderDao().getAllPending(nowMs)
    }

  fun restorePending(nowMs: Long = System.currentTimeMillis()) {
    val reminders =
      runBlocking {
        database.reminderDao().deleteExpired(nowMs)
        database.reminderDao().getAllPending(nowMs)
      }
    reminders.forEach(::registerAlarm)
  }

  private fun registerAlarm(reminder: ScheduledReminderEntity) {
    val pendingIntent = buildPendingIntent(reminder.id)
    if (shouldScheduleExact(reminder.precision, registrar.canScheduleExactAlarms())) {
      registrar.scheduleExact(reminder.id, reminder.dueAtMs, pendingIntent)
    } else {
      registrar.scheduleSoft(reminder.id, reminder.dueAtMs, pendingIntent)
    }
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

  internal fun shouldScheduleExact(precision: String, exactAlarmsAllowed: Boolean): Boolean {
    return precision.equals("exact", ignoreCase = true) && exactAlarmsAllowed
  }
}
