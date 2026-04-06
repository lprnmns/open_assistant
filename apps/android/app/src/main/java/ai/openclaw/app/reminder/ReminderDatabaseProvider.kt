package ai.openclaw.app.reminder

import android.content.Context

object ReminderDatabaseProvider {
  @Volatile private var instance: ReminderDatabase? = null

  fun get(context: Context): ReminderDatabase {
    instance?.let { return it }
    return synchronized(this) {
      instance ?: ReminderDatabase.build(context.applicationContext).also { instance = it }
    }
  }
}
