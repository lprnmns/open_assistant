package ai.openclaw.app.reminder

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "scheduled_reminders")
data class ScheduledReminderEntity(
  @PrimaryKey val id: String,
  val title: String,
  val body: String,
  val dueAtMs: Long,
  val precision: String,
  val priority: String?,
  val cronJobId: String?,
  val createdAtMs: Long,
)
