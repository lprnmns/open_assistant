package ai.openclaw.app.reminder

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
  entities = [ScheduledReminderEntity::class],
  version = 1,
  exportSchema = false,
)
abstract class ReminderDatabase : RoomDatabase() {
  abstract fun reminderDao(): ReminderDao

  companion object {
    const val DATABASE_NAME = "reminders.db"

    fun build(context: Context): ReminderDatabase =
      Room.databaseBuilder(
        context.applicationContext,
        ReminderDatabase::class.java,
        DATABASE_NAME,
      ).build()
  }
}
