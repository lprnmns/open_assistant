package ai.openclaw.app.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import android.util.Log

class DeviceControlAccessibilityService : AccessibilityService() {
  override fun onServiceConnected() {
    super.onServiceConnected()
    activeService = this
    Log.i(Tag, "device-control accessibility service connected")
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    // Execution support is intentionally added in a later slice; this service
    // currently only exposes the permission and lifecycle foundation.
  }

  override fun onInterrupt() {
    Log.w(Tag, "device-control accessibility service interrupted")
  }

  override fun onDestroy() {
    if (activeService === this) {
      activeService = null
    }
    super.onDestroy()
  }

  companion object {
    private const val Tag = "OpenClawDeviceControl"

    @Volatile private var activeService: DeviceControlAccessibilityService? = null

    fun isRunning(): Boolean = activeService != null

    fun settingsIntent(): Intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)

    fun isAccessEnabled(context: Context): Boolean {
      val manager = context.getSystemService(AccessibilityManager::class.java) ?: return false
      val enabledServices =
        manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
      return enabledServices.any { info ->
        info.resolveInfo?.serviceInfo?.packageName == context.packageName &&
          info.resolveInfo?.serviceInfo?.name == DeviceControlAccessibilityService::class.java.name
      }
    }
  }
}
