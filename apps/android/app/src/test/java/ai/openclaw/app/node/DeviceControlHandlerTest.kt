package ai.openclaw.app.node

import ai.openclaw.app.accessibility.DeviceControlExecutionReport
import ai.openclaw.app.protocol.OpenClawUiActionPlan
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceControlHandlerTest {
  @Test
  fun handleUiActionsExecute_rejectsWhenAccessibilityIsDisabled() =
    runTest {
      val handler =
        DeviceControlHandler(
          isAccessibilityEnabled = { false },
          executePlan = { error("executor should not run") },
        )

      val result = handler.handleUiActionsExecute(validPlanJson())

      assertFalse(result.ok)
      assertEquals("ACCESSIBILITY_DISABLED", result.error?.code)
    }

  @Test
  fun handleUiActionsExecute_parsesAndDelegatesPlan() =
    runTest {
      var delegatedPlan: OpenClawUiActionPlan? = null
      val handler =
        DeviceControlHandler(
          isAccessibilityEnabled = { true },
          executePlan = { plan ->
            delegatedPlan = plan
            DeviceControlExecutionReport(planId = plan.planId, executedActions = 2, observations = listOf("root: Launcher"))
          },
        )

      val result = handler.handleUiActionsExecute(validPlanJson())

      assertTrue(result.ok)
      assertEquals("plan-1", delegatedPlan?.planId)
      val payload = Json.parseToJsonElement(result.payloadJson ?: error("expected payload")).jsonObject
      assertEquals("completed", payload.getValue("status").jsonPrimitive.content)
      assertEquals("plan-1", payload.getValue("planId").jsonPrimitive.content)
      assertEquals("2", payload.getValue("executedActions").jsonPrimitive.content)
      assertNotNull(payload["observations"])
    }

  @Test
  fun handleUiActionsExecute_returnsInvalidRequestForBadPlan() =
    runTest {
      val handler =
        DeviceControlHandler(
          isAccessibilityEnabled = { true },
          executePlan = { error("executor should not run") },
        )

      val result = handler.handleUiActionsExecute("""{"kind":"wrong"}""")

      assertFalse(result.ok)
      assertEquals("INVALID_REQUEST", result.error?.code)
    }

  private fun validPlanJson(): String =
    """
    {
      "kind": "ui_actions",
      "planId": "plan-1",
      "targetDeviceId": "phone-1",
      "idempotencyKey": "idem-1",
      "risk": "low",
      "requiresConfirmation": false,
      "actions": [
        {"action": "open_app", "target": "com.instagram.android"},
        {"action": "wait_for_node", "content_desc": "Search"}
      ]
    }
    """.trimIndent()
}
