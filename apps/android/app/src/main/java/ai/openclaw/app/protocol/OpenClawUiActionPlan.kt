package ai.openclaw.app.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

enum class OpenClawUiActionRisk(val rawValue: String) {
  Low("low"),
  Medium("medium"),
  High("high"),
  ;

  companion object {
    fun parse(raw: String): OpenClawUiActionRisk =
      entries.firstOrNull { it.rawValue == raw }
        ?: throw IllegalArgumentException("risk must be low, medium, or high")
  }
}

sealed class OpenClawUiAction {
  data class OpenApp(
    val target: String,
    val timeoutMs: Long?,
  ) : OpenClawUiAction()

  data class ClickNode(
    val id: String?,
    val contentDesc: String?,
    val text: String?,
    val nodeRef: String?,
    val timeoutMs: Long?,
  ) : OpenClawUiAction()

  data class LongClickNode(
    val id: String?,
    val contentDesc: String?,
    val text: String?,
    val nodeRef: String?,
    val timeoutMs: Long?,
  ) : OpenClawUiAction()

  data class TypeText(
    val text: String,
    val id: String?,
    val contentDesc: String?,
    val nodeRef: String?,
    val timeoutMs: Long?,
  ) : OpenClawUiAction()

  data class ClearText(
    val id: String?,
    val contentDesc: String?,
    val nodeRef: String?,
    val timeoutMs: Long?,
  ) : OpenClawUiAction()

  data class TapPoint(
    val x: Float,
    val y: Float,
    val timeoutMs: Long?,
  ) : OpenClawUiAction()

  data class Swipe(
    val startX: Float,
    val startY: Float,
    val endX: Float,
    val endY: Float,
    val amount: String?,
    val durationMs: Long?,
    val timeoutMs: Long?,
  ) : OpenClawUiAction()

  data class WaitForNode(
    val id: String?,
    val contentDesc: String?,
    val text: String?,
    val timeoutMs: Long?,
  ) : OpenClawUiAction()

  data class Scroll(
    val direction: String,
    val amount: String?,
    val timeoutMs: Long?,
  ) : OpenClawUiAction()

  data class RequestConfirmation(
    val prompt: String,
    val risk: OpenClawUiActionRisk?,
  ) : OpenClawUiAction()

  data class Back(val timeoutMs: Long?) : OpenClawUiAction()

  data class Home(val timeoutMs: Long?) : OpenClawUiAction()

  data class Recents(val timeoutMs: Long?) : OpenClawUiAction()

  data class Notifications(val timeoutMs: Long?) : OpenClawUiAction()

  data class QuickSettings(val timeoutMs: Long?) : OpenClawUiAction()

  data class ImeEnter(val timeoutMs: Long?) : OpenClawUiAction()

  data object ObserveScreen : OpenClawUiAction()
}

data class OpenClawUiActionPlan(
  val planId: String,
  val targetDeviceId: String,
  val idempotencyKey: String,
  val risk: OpenClawUiActionRisk,
  val requiresConfirmation: Boolean,
  val actions: List<OpenClawUiAction>,
  val expiresAt: String?,
)

fun parseOpenClawUiActionPlan(paramsJson: String?): OpenClawUiActionPlan {
  val root =
    parseJsonObject(paramsJson)
      ?: throw IllegalArgumentException("ui action plan must be a JSON object")
  requireOnlyKeys(
    root,
    setOf(
      "kind",
      "planId",
      "targetDeviceId",
      "idempotencyKey",
      "risk",
      "requiresConfirmation",
      "actions",
      "expiresAt",
    ),
    "plan",
  )
  val kind = root.requiredString("kind")
  if (kind != "ui_actions") {
    throw IllegalArgumentException("kind must be ui_actions")
  }
  val actions = parseActions(root.requiredArray("actions"))
  val plan =
    OpenClawUiActionPlan(
      planId = root.requiredString("planId"),
      targetDeviceId = root.requiredString("targetDeviceId"),
      idempotencyKey = root.requiredString("idempotencyKey"),
      risk = OpenClawUiActionRisk.parse(root.requiredString("risk")),
      requiresConfirmation = root.requiredBoolean("requiresConfirmation"),
      actions = actions,
      expiresAt = root.optionalString("expiresAt"),
    )
  if (
    plan.risk == OpenClawUiActionRisk.High &&
      (!plan.requiresConfirmation || plan.actions.firstOrNull() !is OpenClawUiAction.RequestConfirmation)
  ) {
    throw IllegalArgumentException("high-risk ui action plans must start with request_confirmation")
  }
  return plan
}

private fun parseActions(actions: JsonArray): List<OpenClawUiAction> {
  if (actions.isEmpty()) {
    throw IllegalArgumentException("actions must contain at least one action")
  }
  if (actions.size > 50) {
    throw IllegalArgumentException("actions must contain at most 50 actions")
  }
  return actions.mapIndexed { index, element ->
    val obj = element as? JsonObject ?: throw IllegalArgumentException("actions[$index] must be an object")
    parseAction(obj)
  }
}

private fun parseAction(obj: JsonObject): OpenClawUiAction {
  return when (val action = obj.requiredString("action")) {
    "open_app" -> parseOpenApp(obj)
    "click_node" -> parseClickNode(obj)
    "long_click_node" -> parseLongClickNode(obj)
    "type_text" -> parseTypeText(obj)
    "clear_text" -> parseClearText(obj)
    "tap_point" -> parseTapPoint(obj)
    "swipe" -> parseSwipe(obj)
    "wait_for_node" -> parseWaitForNode(obj)
    "scroll" -> parseScroll(obj)
    "back" -> parseBack(obj)
    "home" -> parseHome(obj)
    "recents" -> parseRecents(obj)
    "notifications" -> parseNotifications(obj)
    "quick_settings" -> parseQuickSettings(obj)
    "ime_enter" -> parseImeEnter(obj)
    "observe_screen" -> parseObserveScreen(obj)
    "request_confirmation" -> parseRequestConfirmation(obj)
    else -> throw IllegalArgumentException("unknown ui action $action")
  }
}

private fun parseOpenApp(obj: JsonObject): OpenClawUiAction.OpenApp {
  requireOnlyKeys(obj, setOf("action", "target", "timeoutMs"), "action")
  return OpenClawUiAction.OpenApp(
    target = obj.requiredString("target"),
    timeoutMs = obj.optionalTimeoutMs(),
  )
}

private fun parseClickNode(obj: JsonObject): OpenClawUiAction.ClickNode {
  requireOnlyKeys(obj, setOf("action", "id", "content_desc", "text", "node_ref", "timeoutMs"), "action")
  val id = obj.optionalString("id")
  val contentDesc = obj.optionalString("content_desc")
  val text = obj.optionalString("text")
  val nodeRef = obj.optionalString("node_ref")
  if (id == null && contentDesc == null && text == null && nodeRef == null) {
    throw IllegalArgumentException("click_node requires a selector")
  }
  return OpenClawUiAction.ClickNode(
    id = id,
    contentDesc = contentDesc,
    text = text,
    nodeRef = nodeRef,
    timeoutMs = obj.optionalTimeoutMs(),
  )
}

private fun parseLongClickNode(obj: JsonObject): OpenClawUiAction.LongClickNode {
  requireOnlyKeys(obj, setOf("action", "id", "content_desc", "text", "node_ref", "timeoutMs"), "action")
  val id = obj.optionalString("id")
  val contentDesc = obj.optionalString("content_desc")
  val text = obj.optionalString("text")
  val nodeRef = obj.optionalString("node_ref")
  if (id == null && contentDesc == null && text == null && nodeRef == null) {
    throw IllegalArgumentException("long_click_node requires a selector")
  }
  return OpenClawUiAction.LongClickNode(
    id = id,
    contentDesc = contentDesc,
    text = text,
    nodeRef = nodeRef,
    timeoutMs = obj.optionalTimeoutMs(),
  )
}

private fun parseTypeText(obj: JsonObject): OpenClawUiAction.TypeText {
  requireOnlyKeys(obj, setOf("action", "id", "content_desc", "node_ref", "text", "timeoutMs"), "action")
  return OpenClawUiAction.TypeText(
    text = obj.requiredString("text"),
    id = obj.optionalString("id"),
    contentDesc = obj.optionalString("content_desc"),
    nodeRef = obj.optionalString("node_ref"),
    timeoutMs = obj.optionalTimeoutMs(),
  )
}

private fun parseClearText(obj: JsonObject): OpenClawUiAction.ClearText {
  requireOnlyKeys(obj, setOf("action", "id", "content_desc", "node_ref", "timeoutMs"), "action")
  return OpenClawUiAction.ClearText(
    id = obj.optionalString("id"),
    contentDesc = obj.optionalString("content_desc"),
    nodeRef = obj.optionalString("node_ref"),
    timeoutMs = obj.optionalTimeoutMs(),
  )
}

private fun parseTapPoint(obj: JsonObject): OpenClawUiAction.TapPoint {
  requireOnlyKeys(obj, setOf("action", "x", "y", "timeoutMs"), "action")
  return OpenClawUiAction.TapPoint(
    x = obj.requiredCoordinate("x"),
    y = obj.requiredCoordinate("y"),
    timeoutMs = obj.optionalTimeoutMs(),
  )
}

private fun parseSwipe(obj: JsonObject): OpenClawUiAction.Swipe {
  requireOnlyKeys(
    obj,
    setOf("action", "startX", "startY", "endX", "endY", "amount", "durationMs", "timeoutMs"),
    "action",
  )
  val amount = obj.optionalString("amount")
  if (amount != null && amount !in setOf("small", "medium", "large")) {
    throw IllegalArgumentException("swipe amount must be small, medium, or large")
  }
  return OpenClawUiAction.Swipe(
    startX = obj.requiredCoordinate("startX"),
    startY = obj.requiredCoordinate("startY"),
    endX = obj.requiredCoordinate("endX"),
    endY = obj.requiredCoordinate("endY"),
    amount = amount,
    durationMs = obj.optionalDurationMs(),
    timeoutMs = obj.optionalTimeoutMs(),
  )
}

private fun parseWaitForNode(obj: JsonObject): OpenClawUiAction.WaitForNode {
  requireOnlyKeys(obj, setOf("action", "id", "content_desc", "text", "timeoutMs"), "action")
  val id = obj.optionalString("id")
  val contentDesc = obj.optionalString("content_desc")
  val text = obj.optionalString("text")
  if (id == null && contentDesc == null && text == null) {
    throw IllegalArgumentException("wait_for_node requires a selector")
  }
  return OpenClawUiAction.WaitForNode(
    id = id,
    contentDesc = contentDesc,
    text = text,
    timeoutMs = obj.optionalTimeoutMs(),
  )
}

private fun parseScroll(obj: JsonObject): OpenClawUiAction.Scroll {
  requireOnlyKeys(obj, setOf("action", "direction", "amount", "timeoutMs"), "action")
  val direction = obj.requiredString("direction")
  if (direction !in setOf("up", "down", "left", "right")) {
    throw IllegalArgumentException("scroll direction must be up, down, left, or right")
  }
  val amount = obj.optionalString("amount")
  if (amount != null && amount !in setOf("small", "medium", "large")) {
    throw IllegalArgumentException("scroll amount must be small, medium, or large")
  }
  return OpenClawUiAction.Scroll(
    direction = direction,
    amount = amount,
    timeoutMs = obj.optionalTimeoutMs(),
  )
}

private fun parseBack(obj: JsonObject): OpenClawUiAction.Back {
  requireOnlyKeys(obj, setOf("action", "timeoutMs"), "action")
  return OpenClawUiAction.Back(timeoutMs = obj.optionalTimeoutMs())
}

private fun parseHome(obj: JsonObject): OpenClawUiAction.Home {
  requireOnlyKeys(obj, setOf("action", "timeoutMs"), "action")
  return OpenClawUiAction.Home(timeoutMs = obj.optionalTimeoutMs())
}

private fun parseRecents(obj: JsonObject): OpenClawUiAction.Recents {
  requireOnlyKeys(obj, setOf("action", "timeoutMs"), "action")
  return OpenClawUiAction.Recents(timeoutMs = obj.optionalTimeoutMs())
}

private fun parseNotifications(obj: JsonObject): OpenClawUiAction.Notifications {
  requireOnlyKeys(obj, setOf("action", "timeoutMs"), "action")
  return OpenClawUiAction.Notifications(timeoutMs = obj.optionalTimeoutMs())
}

private fun parseQuickSettings(obj: JsonObject): OpenClawUiAction.QuickSettings {
  requireOnlyKeys(obj, setOf("action", "timeoutMs"), "action")
  return OpenClawUiAction.QuickSettings(timeoutMs = obj.optionalTimeoutMs())
}

private fun parseImeEnter(obj: JsonObject): OpenClawUiAction.ImeEnter {
  requireOnlyKeys(obj, setOf("action", "timeoutMs"), "action")
  return OpenClawUiAction.ImeEnter(timeoutMs = obj.optionalTimeoutMs())
}

private fun parseObserveScreen(obj: JsonObject): OpenClawUiAction.ObserveScreen {
  requireOnlyKeys(obj, setOf("action"), "action")
  return OpenClawUiAction.ObserveScreen
}

private fun parseRequestConfirmation(obj: JsonObject): OpenClawUiAction.RequestConfirmation {
  requireOnlyKeys(obj, setOf("action", "prompt", "risk"), "action")
  return OpenClawUiAction.RequestConfirmation(
    prompt = obj.requiredString("prompt"),
    risk = obj.optionalString("risk")?.let(OpenClawUiActionRisk::parse),
  )
}

private fun parseJsonObject(paramsJson: String?): JsonObject? {
  val raw = paramsJson?.trim().takeUnless { it.isNullOrEmpty() } ?: return null
  return runCatching { Json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
}

private fun JsonObject.requiredArray(key: String): JsonArray =
  get(key) as? JsonArray ?: throw IllegalArgumentException("$key required")

private fun JsonObject.requiredBoolean(key: String): Boolean =
  (get(key) as? JsonPrimitive)?.booleanOrNull ?: throw IllegalArgumentException("$key required")

private fun JsonObject.requiredString(key: String): String =
  optionalString(key) ?: throw IllegalArgumentException("$key required")

private fun JsonObject.optionalString(key: String): String? {
  val value = get(key) ?: return null
  val content = value.jsonPrimitive.contentOrNull ?: throw IllegalArgumentException("$key must be a string")
  if (content.isBlank()) {
    throw IllegalArgumentException("$key required")
  }
  return content
}

private fun JsonObject.optionalTimeoutMs(): Long? {
  val value = get("timeoutMs") ?: return null
  val timeoutMs =
    value.jsonPrimitive.longOrNull ?: throw IllegalArgumentException("timeoutMs must be an integer")
  if (timeoutMs !in 0..120_000) {
    throw IllegalArgumentException("timeoutMs must be between 0 and 120000")
  }
  return timeoutMs
}

private fun JsonObject.optionalDurationMs(): Long? {
  val value = get("durationMs") ?: return null
  val durationMs =
    value.jsonPrimitive.longOrNull ?: throw IllegalArgumentException("durationMs must be an integer")
  if (durationMs !in 1..2_000) {
    throw IllegalArgumentException("durationMs must be between 1 and 2000")
  }
  return durationMs
}

private fun JsonObject.requiredCoordinate(key: String): Float {
  val coordinate =
    get(key)?.jsonPrimitive?.doubleOrNull ?: throw IllegalArgumentException("$key required")
  if (coordinate !in 0.0..10_000.0) {
    throw IllegalArgumentException("$key must be between 0 and 10000")
  }
  return coordinate.toFloat()
}

private fun requireOnlyKeys(
  obj: JsonObject,
  allowed: Set<String>,
  label: String,
) {
  val unexpected = obj.keys.firstOrNull { it !in allowed } ?: return
  throw IllegalArgumentException("unexpected $label property $unexpected")
}
