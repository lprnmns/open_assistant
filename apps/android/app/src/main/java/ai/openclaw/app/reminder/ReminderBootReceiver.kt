package ai.openclaw.app.reminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ReminderBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    DeviceAlarmScheduler(appContext = context.applicationContext).restorePending()
  }
}
