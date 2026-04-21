package ai.openclaw.app.accessibility

import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceControlAccessibilityServiceTest {
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
