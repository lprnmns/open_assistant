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
  fun parsesLongClickActionsWithSelectors() {
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
            { "action": "long_click_node", "content_desc": "Instagram" },
            { "action": "long_click_node", "node_ref": "o1n13" }
          ]
        }
        """.trimIndent(),
      )

    val first = plan.actions[0] as OpenClawUiAction.LongClickNode
    val second = plan.actions[1] as OpenClawUiAction.LongClickNode
    assertEquals("Instagram", first.contentDesc)
    assertEquals("o1n13", second.nodeRef)
  }

  @Test
  fun parsesTapPointActions() {
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
          "actions": [{ "action": "tap_point", "x": 540, "y": 960 }]
        }
        """.trimIndent(),
      )

    val action = plan.actions.single() as OpenClawUiAction.TapPoint
    assertEquals(540f, action.x)
    assertEquals(960f, action.y)
  }

  @Test
  fun parsesSwipeActions() {
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
            { "action": "swipe", "startX": 540, "startY": 1600, "endX": 540, "endY": 500 },
            { "action": "swipe", "startX": 900, "startY": 900, "endX": 200, "endY": 900, "durationMs": 450 }
          ]
        }
        """.trimIndent(),
      )

    val first = plan.actions[0] as OpenClawUiAction.Swipe
    val second = plan.actions[1] as OpenClawUiAction.Swipe
    assertEquals(540f, first.startX)
    assertEquals(1600f, first.startY)
    assertEquals(540f, first.endX)
    assertEquals(500f, first.endY)
    assertEquals(null, first.durationMs)
    assertEquals(450L, second.durationMs)
  }

  @Test
  fun parsesOpenUriActions() {
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
            {
              "action": "open_uri",
              "uri": "https://www.instagram.com/rterdogan/",
              "packageName": "com.instagram.android"
            }
          ]
        }
        """.trimIndent(),
      )

    val action = plan.actions.single() as OpenClawUiAction.OpenUri
    assertEquals("https://www.instagram.com/rterdogan/", action.uri)
    assertEquals("com.instagram.android", action.packageName)
  }

  @Test
  fun rejectsOpenUriActionsWithUnsafeSchemes() {
    assertParseFails("open_uri uri must use http or https") {
      parseOpenClawUiActionPlan(
        """
        {
          "kind": "ui_actions",
          "planId": "ui_plan_123",
          "targetDeviceId": "android_redmi",
          "idempotencyKey": "ui_plan_123_attempt_1",
          "risk": "low",
          "requiresConfirmation": false,
          "actions": [{ "action": "open_uri", "uri": "tel:+15555550123" }]
        }
        """.trimIndent(),
      )
    }
  }

  @Test
  fun parsesHomeActions() {
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
          "actions": [{ "action": "home" }]
        }
        """.trimIndent(),
      )

    assertTrue(plan.actions.single() is OpenClawUiAction.Home)
  }

  @Test
  fun parsesSystemNavigationActions() {
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
            { "action": "recents" },
            { "action": "notifications" },
            { "action": "quick_settings" }
          ]
        }
        """.trimIndent(),
      )

    assertTrue(plan.actions[0] is OpenClawUiAction.Recents)
    assertTrue(plan.actions[1] is OpenClawUiAction.Notifications)
    assertTrue(plan.actions[2] is OpenClawUiAction.QuickSettings)
  }

  @Test
  fun parsesImeEnterActions() {
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
          "actions": [{ "action": "ime_enter" }]
        }
        """.trimIndent(),
      )

    assertTrue(plan.actions.single() is OpenClawUiAction.ImeEnter)
  }

  @Test
  fun parsesTypeTextActionsWithTargetSelectors() {
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
            { "action": "type_text", "content_desc": "Search", "text": "Ali" },
            { "action": "type_text", "node_ref": "o1n4", "text": "Ali" }
          ]
        }
        """.trimIndent(),
      )

    val first = plan.actions[0] as OpenClawUiAction.TypeText
    val second = plan.actions[1] as OpenClawUiAction.TypeText
    assertEquals("Search", first.contentDesc)
    assertEquals("Ali", first.text)
    assertEquals("o1n4", second.nodeRef)
  }

  @Test
  fun parsesClearTextActionsWithOptionalTargetSelectors() {
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
            { "action": "clear_text" },
            { "action": "clear_text", "node_ref": "o1n4" }
          ]
        }
        """.trimIndent(),
      )

    val first = plan.actions[0] as OpenClawUiAction.ClearText
    val second = plan.actions[1] as OpenClawUiAction.ClearText
    assertEquals(null, first.nodeRef)
    assertEquals("o1n4", second.nodeRef)
  }

  @Test
  fun rejectsTapPointActionsWithNegativeCoordinates() {
    assertParseFails("x must be between 0 and 10000") {
      parseOpenClawUiActionPlan(
        """
        {
          "kind": "ui_actions",
          "planId": "ui_plan_123",
          "targetDeviceId": "android_redmi",
          "idempotencyKey": "ui_plan_123_attempt_1",
          "risk": "low",
          "requiresConfirmation": false,
          "actions": [{ "action": "tap_point", "x": -1, "y": 960 }]
        }
        """.trimIndent(),
      )
    }
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
