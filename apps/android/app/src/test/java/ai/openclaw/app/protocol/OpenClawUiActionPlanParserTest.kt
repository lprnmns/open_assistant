package ai.openclaw.app.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class OpenClawUiActionPlanParserTest {
  @Test
  fun parsesValidUiActionPlan() {
    val plan =
      parseOpenClawUiActionPlan(
        """
        {
          "kind": "ui_actions",
          "planId": "ui_plan_123",
          "targetDeviceId": "android_redmi",
          "idempotencyKey": "ui_plan_123_attempt_1",
          "risk": "low",
          "requiresConfirmation": false,
          "actions": [
            { "action": "open_app", "target": "com.instagram.android" },
            { "action": "click_node", "content_desc": "Search" },
            { "action": "type_text", "text": "Ali" },
            { "action": "observe_screen" }
          ]
        }
        """.trimIndent(),
      )

    assertEquals("ui_plan_123", plan.planId)
    assertEquals("android_redmi", plan.targetDeviceId)
    assertEquals(OpenClawUiActionRisk.Low, plan.risk)
    assertEquals(4, plan.actions.size)
    assertTrue(plan.actions[0] is OpenClawUiAction.OpenApp)
    assertTrue(plan.actions[1] is OpenClawUiAction.ClickNode)
  }

  @Test
  fun rejectsMissingIdempotencyKey() {
    assertParseFails("idempotencyKey required") {
      parseOpenClawUiActionPlan(
        """
        {
          "kind": "ui_actions",
          "planId": "ui_plan_123",
          "targetDeviceId": "android_redmi",
          "risk": "low",
          "requiresConfirmation": false,
          "actions": [{ "action": "observe_screen" }]
        }
        """.trimIndent(),
      )
    }
  }

  @Test
  fun rejectsClickActionsWithoutSelector() {
    assertParseFails("click_node requires a selector") {
      parseOpenClawUiActionPlan(
        """
        {
          "kind": "ui_actions",
          "planId": "ui_plan_123",
          "targetDeviceId": "android_redmi",
          "idempotencyKey": "ui_plan_123_attempt_1",
          "risk": "low",
          "requiresConfirmation": false,
          "actions": [{ "action": "click_node" }]
        }
        """.trimIndent(),
      )
    }
  }

  @Test
  fun parsesClickActionsWithObservedNodeReference() {
    val plan =
      parseOpenClawUiActionPlan(
        """
        {
          "kind": "ui_actions",
          "planId": "ui_plan_123",
          "targetDeviceId": "android_redmi",
          "idempotencyKey": "ui_plan_123_attempt_1",
          "risk": "low",
          "requiresConfirmation": false,
          "actions": [{ "action": "click_node", "node_ref": "o1n13" }]
        }
        """.trimIndent(),
      )

    val action = plan.actions.single() as OpenClawUiAction.ClickNode
    assertEquals("o1n13", action.nodeRef)
  }

  @Test
  fun rejectsArbitraryActionFields() {
    assertParseFails("unexpected action property shell") {
      parseOpenClawUiActionPlan(
        """
        {
          "kind": "ui_actions",
          "planId": "ui_plan_123",
          "targetDeviceId": "android_redmi",
          "idempotencyKey": "ui_plan_123_attempt_1",
          "risk": "low",
          "requiresConfirmation": false,
          "actions": [
            { "action": "open_app", "target": "com.instagram.android", "shell": "rm -rf /" }
          ]
        }
        """.trimIndent(),
      )
    }
  }

  @Test
  fun rejectsHighRiskPlansWithoutLeadingConfirmation() {
    assertParseFails("high-risk ui action plans must start with request_confirmation") {
      parseOpenClawUiActionPlan(
        """
        {
          "kind": "ui_actions",
          "planId": "ui_plan_123",
          "targetDeviceId": "android_redmi",
          "idempotencyKey": "ui_plan_123_attempt_1",
          "risk": "high",
          "requiresConfirmation": true,
          "actions": [{ "action": "open_app", "target": "com.instagram.android" }]
        }
        """.trimIndent(),
      )
    }
  }

  private fun assertParseFails(
    expectedMessagePart: String,
    block: () -> Unit,
  ) {
    try {
      block()
      fail("expected parser to reject invalid ui action plan")
    } catch (err: IllegalArgumentException) {
      assertTrue(err.message.orEmpty().contains(expectedMessagePart))
    }
  }
}
