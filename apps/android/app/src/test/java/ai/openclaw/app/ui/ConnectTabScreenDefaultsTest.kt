package ai.openclaw.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectTabScreenDefaultsTest {
  @Test
  fun `cloud state defaults connect tab to cloud mode`() {
    assertEquals(
      ConnectInputMode.Cloud,
      resolveInitialConnectInputMode(
        cloudEnabled = true,
        gatewayCloudBaseUrl = "",
        gatewayAccountToken = "",
        manualEnabled = false,
        manualHost = "",
        gatewayToken = "",
      ),
    )
    assertEquals(
      ConnectInputMode.Cloud,
      resolveInitialConnectInputMode(
        cloudEnabled = false,
        gatewayCloudBaseUrl = "",
        gatewayAccountToken = "account-token",
        manualEnabled = false,
        manualHost = "",
        gatewayToken = "",
      ),
    )
  }

  @Test
  fun `manual state defaults connect tab to manual mode`() {
    assertEquals(
      ConnectInputMode.Manual,
      resolveInitialConnectInputMode(
        cloudEnabled = false,
        gatewayCloudBaseUrl = "",
        gatewayAccountToken = "",
        manualEnabled = true,
        manualHost = "",
        gatewayToken = "",
      ),
    )
  }

  @Test
  fun `cloud and manual modes open advanced controls by default`() {
    assertTrue(resolveInitialConnectAdvancedOpen(ConnectInputMode.Cloud))
    assertTrue(resolveInitialConnectAdvancedOpen(ConnectInputMode.Manual))
    assertFalse(resolveInitialConnectAdvancedOpen(ConnectInputMode.SetupCode))
  }

  @Test
  fun `without saved state connect tab defaults to cloud mode`() {
    assertEquals(
      ConnectInputMode.Cloud,
      resolveInitialConnectInputMode(
        cloudEnabled = false,
        gatewayCloudBaseUrl = "",
        gatewayAccountToken = "",
        manualEnabled = false,
        manualHost = "",
        gatewayToken = "",
      ),
    )
  }
}
