package ai.openclaw.app.node

import ai.openclaw.app.accessibility.DeviceControlAccessibilityService
import ai.openclaw.app.accessibility.DeviceControlExecutionException
import ai.openclaw.app.accessibility.DeviceControlExecutionReport
import ai.openclaw.app.accessibility.DeviceControlObservedNode
import ai.openclaw.app.gateway.GatewaySession
import ai.openclaw.app.protocol.OpenClawUiActionPlan
import ai.openclaw.app.protocol.parseOpenClawUiActionPlan
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class DeviceControlHandler(
  private val isAccessibilityEnabled: () -> Boolean,
  private val executePlan: suspend (OpenClawUiActionPlan) -> DeviceControlExecutionReport = { plan ->
    DeviceControlAccessibilityService.executePlan(plan)
  },
) {
  suspend fun handleUiActionsExecute(paramsJson: String?): GatewaySession.InvokeResult {
    val plan =
      try {
        parseOpenClawUiActionPlan(paramsJson)
      } catch (err: IllegalArgumentException) {
        return GatewaySession.InvokeResult.error(
          code = "INVALID_REQUEST",
          message = err.message ?: "INVALID_REQUEST: invalid UI action plan",
        )
      }

    if (!isAccessibilityEnabled()) {
      return GatewaySession.InvokeResult.error(
        code = "ACCESSIBILITY_DISABLED",
        message = "ACCESSIBILITY_DISABLED: enable OpenClaw Device Control in Android Accessibility settings",
      )
    }

    val report =
      try {
        executePlan(plan)
      } catch (err: DeviceControlExecutionException) {
        return GatewaySession.InvokeResult.error(code = err.code, message = err.message)
      } catch (err: Throwable) {
        return GatewaySession.InvokeResult.error(
          code = "EXECUTION_FAILED",
          message = err.message ?: "UI action execution failed",
        )
      }

    return GatewaySession.InvokeResult.ok(report.toPayloadJson())
  }

  private fun DeviceControlExecutionReport.toPayloadJson(): String =
    buildJsonObject {
      put("status", JsonPrimitive("completed"))
      put("planId", JsonPrimitive(planId))
      put("executedActions", JsonPrimitive(executedActions))
      put(
        "observations",
        buildJsonArray {
          observations.forEach { observation -> add(JsonPrimitive(observation)) }
        },
      )
      put(
        "observedNodes",
        buildJsonArray {
          observedNodes.forEach { node -> add(node.toJsonObject()) }
        },
      )
    }.toString()

  private fun DeviceControlObservedNode.toJsonObject() =
    buildJsonObject {
      put("nodeRef", nodeRef)
      putNullableString("text", text)
      putNullableString("contentDescription", contentDescription)
      putNullableString("viewId", viewId)
      putNullableString("className", className)
      putNullableString("packageName", packageName)
      put(
        "bounds",
        buildJsonObject {
          put("left", bounds.left)
          put("top", bounds.top)
          put("right", bounds.right)
          put("bottom", bounds.bottom)
        },
      )
      put("clickable", clickable)
      put("enabled", enabled)
      put("focused", focused)
      put("selected", selected)
      put("editable", editable)
      put("scrollable", scrollable)
    }

  private fun JsonObjectBuilder.putNullableString(key: String, value: String?) {
    if (value != null) {
      put(key, value)
    }
  }
}
