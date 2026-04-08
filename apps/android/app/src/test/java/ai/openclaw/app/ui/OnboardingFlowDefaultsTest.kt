package ai.openclaw.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OnboardingFlowDefaultsTest {
  @Test
  fun `cloud credentials default onboarding to cloud mode`() {
    assertEquals(
      GatewayInputMode.Cloud,
      resolveInitialGatewayInputMode(
        persistedGatewayCloudBaseUrl = "https://cloud.openclaw.ai",
        persistedGatewayAccountToken = "",
      ),
    )
    assertEquals(
      GatewayInputMode.Cloud,
      resolveInitialGatewayInputMode(
        persistedGatewayCloudBaseUrl = "",
        persistedGatewayAccountToken = "account-token",
      ),
    )
  }

  @Test
  fun `without cloud credentials onboarding still defaults to cloud mode`() {
    assertEquals(
      GatewayInputMode.Cloud,
      resolveInitialGatewayInputMode(
        persistedGatewayCloudBaseUrl = "",
        persistedGatewayAccountToken = "",
      ),
    )
  }

  @Test
  fun `cloud mode opens connection methods by default`() {
    assertTrue(resolveInitialGatewayAdvancedOpen(GatewayInputMode.Cloud))
    assertFalse(resolveInitialGatewayAdvancedOpen(GatewayInputMode.SetupCode))
    assertFalse(resolveInitialGatewayAdvancedOpen(GatewayInputMode.Manual))
  }
}
