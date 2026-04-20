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

  private data class FakeNode(
    val id: String,
    val clickable: Boolean,
    val parent: FakeNode? = null,
  )
}
