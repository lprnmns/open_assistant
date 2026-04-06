package ai.openclaw.app.reminder

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert

@Dao
interface ReminderDao {
  @Upsert
  suspend fun upsert(reminder: ScheduledReminderEntity)

  @Query("SELECT * FROM scheduled_reminders WHERE id = :id LIMIT 1")
  suspend fun getById(id: String): ScheduledReminderEntity?

  @Query("SELECT * FROM scheduled_reminders WHERE dueAtMs >= :nowMs ORDER BY dueAtMs ASC")
  suspend fun getAllPending(nowMs: Long): List<ScheduledReminderEntity>

  @Query("SELECT * FROM scheduled_reminders ORDER BY dueAtMs ASC")
  suspend fun getAll(): List<ScheduledReminderEntity>

  @Query("DELETE FROM scheduled_reminders WHERE id = :id")
  suspend fun deleteById(id: String)

  @Query("DELETE FROM scheduled_reminders WHERE dueAtMs < :nowMs")
  suspend fun deleteExpired(nowMs: Long)
}
