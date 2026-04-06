package ai.openclaw.app.reminder

data class ReminderScheduleRequest(
  val id: String,
  val title: String,
  val body: String,
  val dueAtMs: Long,
  val precision: String,
  val priority: String?,
  val cronJobId: String?,
  val createdAtMs: Long,
)

interface ReminderScheduler {
  fun schedule(request: ReminderScheduleRequest)

  fun cancel(id: String)

  fun listPending(nowMs: Long): List<ScheduledReminderEntity>
}
