package ai.openclaw.app.accessibility

import android.accessibilityservice.AccessibilityService
import ai.openclaw.app.protocol.OpenClawUiAction
import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceControlAccessibilityServiceTest {
  @Test
  fun globalNavigationActionId_mapsHomeActionToAndroidHome() {
    assertEquals(
      AccessibilityService.GLOBAL_ACTION_HOME,
      globalNavigationActionId(OpenClawUiAction.Home(timeoutMs = null)),
    )
  }

  @Test
  fun globalNavigationActionId_mapsSystemNavigationActions() {
    assertEquals(
      AccessibilityService.GLOBAL_ACTION_RECENTS,
      globalNavigationActionId(OpenClawUiAction.Recents(timeoutMs = null)),
    )
    assertEquals(
      AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS,
      globalNavigationActionId(OpenClawUiAction.Notifications(timeoutMs = null)),
    )
    assertEquals(
      AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS,
      globalNavigationActionId(OpenClawUiAction.QuickSettings(timeoutMs = null)),
    )
  }

  @Test
  fun imeEnterActionId_usesAndroidImeEnterAction() {
    assertEquals(
      android.R.id.accessibilityActionImeEnter,
      imeEnterActionId(),
    )
  }

  @Test
  fun swipeDurationMs_mapsAmountsToBoundedGestureDurations() {
    assertEquals(250L, swipeDurationMs("small"))
    assertEquals(450L, swipeDurationMs("medium"))
    assertEquals(650L, swipeDurationMs("large"))
    assertEquals(450L, swipeDurationMs(null))
  }

  @Test
  fun resolveClickableActionTarget_usesClickableAncestorForStaticText() {
    val root = FakeNode(id = "settings-tab", clickable = true)
    val label = FakeNode(id = "settings-label", clickable = false, parent = root)

    val target =
      resolveClickableActionTarget(
        start = label,
        isClickable = { node -> node.clickable },
        parentOf = { node -> node.parent },
      )

    assertEquals(root, target)
  }

  @Test
  fun resolveClickableActionTarget_fallsBackToMatchedNodeWhenNoClickableAncestorExists() {
    val root = FakeNode(id = "root", clickable = false)
    val label = FakeNode(id = "settings-label", clickable = false, parent = root)

    val target =
      resolveClickableActionTarget(
        start = label,
        isClickable = { node -> node.clickable },
        parentOf = { node -> node.parent },
      )

    assertEquals(label, target)
  }

  @Test
  fun observedBoundsCenter_returnsCenterForNonEmptyBounds() {
    val center = observedBoundsCenter(DeviceControlObservedBounds(left = 10, top = 20, right = 20, bottom = 40))

    assertEquals(15f, center?.first)
    assertEquals(30f, center?.second)
  }

  @Test
  fun observedBoundsCenter_rejectsEmptyBounds() {
    val center = observedBoundsCenter(DeviceControlObservedBounds(left = 10, top = 20, right = 10, bottom = 40))

    assertEquals(null, center)
  }

  private data class FakeNode(
    val id: String,
    val clickable: Boolean,
    val parent: FakeNode? = null,
  )
}
