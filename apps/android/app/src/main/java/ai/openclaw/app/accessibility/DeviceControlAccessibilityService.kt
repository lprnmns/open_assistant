package ai.openclaw.app.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import ai.openclaw.app.protocol.OpenClawUiAction
import ai.openclaw.app.protocol.OpenClawUiActionPlan
import ai.openclaw.app.protocol.OpenClawUiActionRisk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

data class DeviceControlExecutionReport(
  val planId: String,
  val executedActions: Int,
  val observations: List<String> = emptyList(),
)

class DeviceControlExecutionException(
  val code: String,
  override val message: String,
) : Exception(message)

class DeviceControlAccessibilityService : AccessibilityService() {
  override fun onServiceConnected() {
    super.onServiceConnected()
    activeService = this
    Log.i(Tag, "device-control accessibility service connected")
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    // Commands use point-in-time root/window snapshots; no event stream state is needed yet.
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
    private const val PostActionDelayMs = 250L
    private const val DefaultActionTimeoutMs = 5_000L

    @Volatile private var activeService: DeviceControlAccessibilityService? = null

    fun isRunning(): Boolean = activeService != null

    fun settingsIntent(): Intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)

    suspend fun executePlan(plan: OpenClawUiActionPlan): DeviceControlExecutionReport {
      if (plan.risk == OpenClawUiActionRisk.High) {
        throw DeviceControlExecutionException(
          code = "USER_CONFIRMATION_REQUIRED",
          message = "High-risk UI action plans require an in-app confirmation gate before execution.",
        )
      }
      val service =
        activeService
          ?: throw DeviceControlExecutionException(
            code = "ACCESSIBILITY_DISABLED",
            message = "OpenClaw Device Control accessibility service is not running.",
          )
      return service.executePlanInternal(plan)
    }

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

  private suspend fun executePlanInternal(plan: OpenClawUiActionPlan): DeviceControlExecutionReport =
    withContext(Dispatchers.Main.immediate) {
      var executed = 0
      val observations = mutableListOf<String>()
      for (action in plan.actions) {
        when (action) {
          is OpenClawUiAction.OpenApp -> {
            launchApp(action.target)
            executed += 1
            delay(PostActionDelayMs)
          }
          is OpenClawUiAction.ClickNode -> {
            val node = waitForNode(action.selector(), action.timeoutMs ?: DefaultActionTimeoutMs)
            if (!node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
              throw DeviceControlExecutionException(
                code = "ACTION_FAILED",
                message = "Unable to click the requested UI node.",
              )
            }
            executed += 1
            delay(PostActionDelayMs)
          }
          is OpenClawUiAction.TypeText -> {
            val node = focusedEditableNode()
            val args =
              Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, action.text)
              }
            if (!node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
              throw DeviceControlExecutionException(
                code = "ACTION_FAILED",
                message = "Unable to type into the focused UI node.",
              )
            }
            executed += 1
            delay(PostActionDelayMs)
          }
          is OpenClawUiAction.WaitForNode -> {
            waitForNode(action.selector(), action.timeoutMs ?: DefaultActionTimeoutMs)
            executed += 1
          }
          is OpenClawUiAction.Scroll -> {
            val node = firstScrollableNode()
            val actionId =
              when (action.direction) {
                "up", "left" -> AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                else -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
              }
            if (!node.performAction(actionId)) {
              throw DeviceControlExecutionException(
                code = "ACTION_FAILED",
                message = "Unable to scroll the active UI.",
              )
            }
            executed += 1
            delay(PostActionDelayMs)
          }
          is OpenClawUiAction.Back -> {
            if (!performGlobalAction(GLOBAL_ACTION_BACK)) {
              throw DeviceControlExecutionException(
                code = "ACTION_FAILED",
                message = "Unable to perform Android back action.",
              )
            }
            executed += 1
            delay(PostActionDelayMs)
          }
          OpenClawUiAction.ObserveScreen -> observations += observeRootSummary()
          is OpenClawUiAction.RequestConfirmation -> {
            throw DeviceControlExecutionException(
              code = "USER_CONFIRMATION_REQUIRED",
              message = "This UI action plan requires in-app confirmation before execution.",
            )
          }
        }
      }
      DeviceControlExecutionReport(planId = plan.planId, executedActions = executed, observations = observations)
    }

  private fun launchApp(packageName: String) {
    val launchIntent =
      packageManager.getLaunchIntentForPackage(packageName)
        ?: throw DeviceControlExecutionException(
          code = "APP_NOT_FOUND",
          message = "No launchable app found for package $packageName.",
        )
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    startActivity(launchIntent)
  }

  private suspend fun waitForNode(selector: NodeSelector, timeoutMs: Long): AccessibilityNodeInfo {
    val deadline = System.currentTimeMillis() + timeoutMs.coerceAtLeast(0L)
    while (true) {
      findNode(selector)?.let { return it }
      if (System.currentTimeMillis() >= deadline) {
        throw DeviceControlExecutionException(
          code = "NODE_NOT_FOUND",
          message = "No UI node matched the requested selector.",
        )
      }
      delay(100L)
    }
  }

  private fun focusedEditableNode(): AccessibilityNodeInfo {
    val root =
      rootInActiveWindow
        ?: throw DeviceControlExecutionException(
          code = "SCREEN_UNAVAILABLE",
          message = "No active accessibility window is available.",
        )
    root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable }?.let { return it }
    return walk(root).firstOrNull { it.isEditable }
      ?: throw DeviceControlExecutionException(
        code = "NODE_NOT_FOUND",
        message = "No editable UI node is focused or visible.",
      )
  }

  private fun firstScrollableNode(): AccessibilityNodeInfo {
    val root =
      rootInActiveWindow
        ?: throw DeviceControlExecutionException(
          code = "SCREEN_UNAVAILABLE",
          message = "No active accessibility window is available.",
        )
    return walk(root).firstOrNull { it.isScrollable }
      ?: throw DeviceControlExecutionException(
        code = "NODE_NOT_FOUND",
        message = "No scrollable UI node is visible.",
      )
  }

  private fun findNode(selector: NodeSelector): AccessibilityNodeInfo? {
    val roots =
      listOfNotNull(rootInActiveWindow) +
        windows.mapNotNull { window -> window.root }
    return roots.asSequence().flatMap { root -> walk(root).asSequence() }.firstOrNull { node ->
      selector.matches(node)
    }
  }

  private fun observeRootSummary(): String {
    val root = rootInActiveWindow ?: return "screen unavailable"
    return walk(root)
      .asSequence()
      .mapNotNull { node -> node.summaryLabel() }
      .take(30)
      .joinToString(separator = " | ")
      .ifBlank { "screen available, no labeled nodes" }
  }

  private fun walk(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> {
    val nodes = mutableListOf<AccessibilityNodeInfo>()
    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue.add(root)
    while (queue.isNotEmpty() && nodes.size < 500) {
      val node = queue.removeFirst()
      nodes.add(node)
      for (index in 0 until node.childCount) {
        node.getChild(index)?.let { queue.add(it) }
      }
    }
    return nodes
  }

  private fun OpenClawUiAction.ClickNode.selector(): NodeSelector =
    NodeSelector(id = id, contentDescription = contentDesc, text = text)

  private fun OpenClawUiAction.WaitForNode.selector(): NodeSelector =
    NodeSelector(id = id, contentDescription = contentDesc, text = text)

  private data class NodeSelector(
    val id: String?,
    val contentDescription: String?,
    val text: String?,
  ) {
    fun matches(node: AccessibilityNodeInfo): Boolean {
      val nodeId = node.viewIdResourceName?.trim().orEmpty()
      val nodeDescription = node.contentDescription?.toString()?.trim().orEmpty()
      val nodeText = node.text?.toString()?.trim().orEmpty()
      return listOfNotNull(
        id?.let { expected -> nodeId == expected || nodeId.endsWith(":id/$expected") },
        contentDescription?.let { expected -> nodeDescription.matchesSelectorText(expected) },
        text?.let { expected -> nodeText.matchesSelectorText(expected) },
      ).all { it }
    }

    private fun String.matchesSelectorText(expected: String): Boolean {
      val trimmed = expected.trim()
      if (trimmed.isEmpty()) return false
      return equals(trimmed, ignoreCase = true) || contains(trimmed, ignoreCase = true)
    }
  }

  private fun CharSequence?.summaryLabel(): String? {
    val value = this?.toString()?.trim().orEmpty()
    return value.ifBlank { null }
  }

  private fun AccessibilityNodeInfo.summaryLabel(): String? =
    contentDescription.summaryLabel() ?: text.summaryLabel() ?: viewIdResourceName.summaryLabel()

}
