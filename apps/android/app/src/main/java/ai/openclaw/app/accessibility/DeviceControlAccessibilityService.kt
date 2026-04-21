package ai.openclaw.app.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
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
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

data class DeviceControlExecutionReport(
  val planId: String,
  val executedActions: Int,
  val observations: List<String> = emptyList(),
  val observedNodes: List<DeviceControlObservedNode> = emptyList(),
)

data class DeviceControlObservedBounds(
  val left: Int,
  val top: Int,
  val right: Int,
  val bottom: Int,
)

data class DeviceControlObservedNode(
  val nodeRef: String,
  val text: String? = null,
  val contentDescription: String? = null,
  val viewId: String? = null,
  val className: String? = null,
  val packageName: String? = null,
  val bounds: DeviceControlObservedBounds,
  val clickable: Boolean,
  val enabled: Boolean,
  val focused: Boolean,
  val selected: Boolean,
  val editable: Boolean,
  val scrollable: Boolean,
)

class DeviceControlExecutionException(
  val code: String,
  override val message: String,
) : Exception(message)

class DeviceControlAccessibilityService : AccessibilityService() {
  private val observedNodesByRef = mutableMapOf<String, DeviceControlObservedNode>()

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
    private const val MaxObservedNodes = 80
    private const val MaxObservedTextChars = 160

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
      var observationIndex = 0
      val observations = mutableListOf<String>()
      val observedNodes = mutableListOf<DeviceControlObservedNode>()
      for (action in plan.actions) {
        when (action) {
          is OpenClawUiAction.OpenApp -> {
            launchApp(action.target)
            executed += 1
            delay(PostActionDelayMs)
          }
          is OpenClawUiAction.ClickNode -> {
            if (action.nodeRef != null) {
              val observedNode =
                observedNodesByRef[action.nodeRef]
                  ?: throw DeviceControlExecutionException(
                    code = "NODE_NOT_FOUND",
                    message = "No observed UI node matched node_ref ${action.nodeRef}. Run observe_screen first.",
                  )
              if (!tapObservedBoundsCenter(observedNode.bounds)) {
                throw DeviceControlExecutionException(
                  code = "ACTION_FAILED",
                  message = "Unable to tap the observed UI node.",
                )
              }
            } else {
              val node = waitForNode(action.selector(), action.timeoutMs ?: DefaultActionTimeoutMs)
              if (!performNodeClick(node)) {
                throw DeviceControlExecutionException(
                  code = "ACTION_FAILED",
                  message = "Unable to click the requested UI node.",
                )
              }
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
          is OpenClawUiAction.ImeEnter -> {
            val node = focusedEditableNode()
            if (!node.performAction(imeEnterActionId())) {
              throw DeviceControlExecutionException(
                code = "ACTION_FAILED",
                message = "Unable to perform IME enter on the focused UI node.",
              )
            }
            executed += 1
            delay(PostActionDelayMs)
          }
          is OpenClawUiAction.TapPoint -> {
            if (!tapPoint(action.x, action.y)) {
              throw DeviceControlExecutionException(
                code = "ACTION_FAILED",
                message = "Unable to tap the requested screen coordinate.",
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
            if (!performGlobalAction(globalNavigationActionId(action))) {
              throw DeviceControlExecutionException(
                code = "ACTION_FAILED",
                message = "Unable to perform Android back action.",
              )
            }
            executed += 1
            delay(PostActionDelayMs)
          }
          is OpenClawUiAction.Home -> {
            if (!performGlobalAction(globalNavigationActionId(action))) {
              throw DeviceControlExecutionException(
                code = "ACTION_FAILED",
                message = "Unable to perform Android home action.",
              )
            }
            executed += 1
            delay(PostActionDelayMs)
          }
          is OpenClawUiAction.Recents,
          is OpenClawUiAction.Notifications,
          is OpenClawUiAction.QuickSettings,
          -> {
            if (!performGlobalAction(globalNavigationActionId(action))) {
              throw DeviceControlExecutionException(
                code = "ACTION_FAILED",
                message = "Unable to perform Android system navigation action.",
              )
            }
            executed += 1
            delay(PostActionDelayMs)
          }
          OpenClawUiAction.ObserveScreen -> {
            observationIndex += 1
            observations += observeRootSummary()
            observedNodes += observeStructuredNodes(observationIndex)
          }
          is OpenClawUiAction.RequestConfirmation -> {
            throw DeviceControlExecutionException(
              code = "USER_CONFIRMATION_REQUIRED",
              message = "This UI action plan requires in-app confirmation before execution.",
            )
          }
        }
      }
      DeviceControlExecutionReport(
        planId = plan.planId,
        executedActions = executed,
        observations = observations,
        observedNodes = observedNodes,
      )
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

  private suspend fun performNodeClick(node: AccessibilityNodeInfo): Boolean {
    val clickTarget = resolveAccessibilityClickTarget(node)
    // Gesture tap is closer to physical user input and works for Compose text labels whose
    // accessibility ACTION_CLICK may be accepted without activating the surrounding tab.
    return tapNodeCenter(clickTarget) ||
      clickTarget.performAction(AccessibilityNodeInfo.ACTION_CLICK) ||
      (clickTarget !== node && node.performAction(AccessibilityNodeInfo.ACTION_CLICK))
  }

  private suspend fun tapNodeCenter(node: AccessibilityNodeInfo): Boolean {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    return tapObservedBoundsCenter(
      DeviceControlObservedBounds(
        left = bounds.left,
        top = bounds.top,
        right = bounds.right,
        bottom = bounds.bottom,
      ),
    )
  }

  private suspend fun tapObservedBoundsCenter(bounds: DeviceControlObservedBounds): Boolean {
    val center = observedBoundsCenter(bounds) ?: return false
    return tapPoint(center.first, center.second)
  }

  private suspend fun tapPoint(
    x: Float,
    y: Float,
  ): Boolean =
    suspendCancellableCoroutine { continuation ->
      val path =
        Path().apply {
          moveTo(x, y)
        }
      val gesture =
        GestureDescription.Builder()
          .addStroke(GestureDescription.StrokeDescription(path, 0L, 80L))
          .build()
      val dispatched =
        dispatchGesture(
          gesture,
          object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
              if (continuation.isActive) {
                continuation.resume(true)
              }
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
              if (continuation.isActive) {
                continuation.resume(false)
              }
            }
          },
          null,
        )
      if (!dispatched && continuation.isActive) {
        continuation.resume(false)
      }
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

  private fun observeStructuredNodes(observationIndex: Int): List<DeviceControlObservedNode> {
    val root =
      rootInActiveWindow
        ?: run {
          observedNodesByRef.clear()
          return emptyList()
        }
    val snapshot =
      walk(root)
      .asSequence()
      .mapIndexedNotNull { index, node -> node.toObservedNode(observationIndex, index) }
      .take(MaxObservedNodes)
      .toList()
    observedNodesByRef.clear()
    snapshot.forEach { node -> observedNodesByRef[node.nodeRef] = node }
    return snapshot
  }

  private fun AccessibilityNodeInfo.toObservedNode(
    observationIndex: Int,
    traversalIndex: Int,
  ): DeviceControlObservedNode? {
    val bounds = Rect()
    getBoundsInScreen(bounds)
    val observed =
      DeviceControlObservedNode(
        nodeRef = "o${observationIndex}n$traversalIndex",
        text = text.normalizedObservationText(),
        contentDescription = contentDescription.normalizedObservationText(),
        viewId = viewIdResourceName.normalizedObservationText(),
        className = className.normalizedObservationText(),
        packageName = packageName.normalizedObservationText(),
        bounds =
          DeviceControlObservedBounds(
            left = bounds.left,
            top = bounds.top,
            right = bounds.right,
            bottom = bounds.bottom,
          ),
        clickable = isClickable,
        enabled = isEnabled,
        focused = isFocused,
        selected = isSelected,
        editable = isEditable,
        scrollable = isScrollable,
      )
    return observed.takeIf { it.hasPlanningSignal() }
  }

  private fun DeviceControlObservedNode.hasPlanningSignal(): Boolean =
    text != null ||
      contentDescription != null ||
      viewId != null ||
      clickable ||
      editable ||
      scrollable

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

  private fun CharSequence?.normalizedObservationText(): String? {
    val value = this?.toString()?.replace(Regex("\\s+"), " ")?.trim().orEmpty()
    if (value.isBlank()) return null
    return if (value.length <= MaxObservedTextChars) value else value.take(MaxObservedTextChars)
  }

  private fun AccessibilityNodeInfo.summaryLabel(): String? =
    contentDescription.summaryLabel() ?: text.summaryLabel() ?: viewIdResourceName.summaryLabel()
}

private fun resolveAccessibilityClickTarget(node: AccessibilityNodeInfo): AccessibilityNodeInfo =
  resolveClickableActionTarget(
    start = node,
    isClickable = { candidate -> candidate.isClickable },
    parentOf = { candidate -> candidate.parent },
  )

internal fun <T> resolveClickableActionTarget(
  start: T,
  isClickable: (T) -> Boolean,
  parentOf: (T) -> T?,
): T {
  var current: T? = start
  while (current != null) {
    if (isClickable(current)) {
      return current
    }
    current = parentOf(current)
  }
  return start
}

internal fun observedBoundsCenter(bounds: DeviceControlObservedBounds): Pair<Float, Float>? {
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return null
  }
  return Pair(
    first = (bounds.left + bounds.right) / 2f,
    second = (bounds.top + bounds.bottom) / 2f,
  )
}

internal fun globalNavigationActionId(action: OpenClawUiAction): Int =
  when (action) {
    is OpenClawUiAction.Back -> AccessibilityService.GLOBAL_ACTION_BACK
    is OpenClawUiAction.Home -> AccessibilityService.GLOBAL_ACTION_HOME
    is OpenClawUiAction.Recents -> AccessibilityService.GLOBAL_ACTION_RECENTS
    is OpenClawUiAction.Notifications -> AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
    is OpenClawUiAction.QuickSettings -> AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS
    else -> throw IllegalArgumentException("unsupported global navigation action")
  }

internal fun imeEnterActionId(): Int = android.R.id.accessibilityActionImeEnter
