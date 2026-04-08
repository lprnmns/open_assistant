package ai.openclaw.app.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GatewayEndpointTest {
  @Test
  fun cloud_parsesHttpsBaseUrlIntoTlsEndpoint() {
    val endpoint = GatewayEndpoint.cloud("https://cloud.openclaw.ai")
    assertNotNull(endpoint)
    assertEquals("cloud.openclaw.ai", endpoint?.host)
    assertEquals(443, endpoint?.port)
    assertTrue(endpoint?.tlsEnabled == true)
  }

  @Test
  fun cloud_parsesHttpBaseUrlWithExplicitPort() {
    val endpoint = GatewayEndpoint.cloud("http://127.0.0.1:18789")
    assertNotNull(endpoint)
    assertEquals("127.0.0.1", endpoint?.host)
    assertEquals(18789, endpoint?.port)
    assertFalse(endpoint?.tlsEnabled == true)
  }

  @Test
  fun cloud_rejectsNonRootPathsAndQueryStrings() {
    assertNull(GatewayEndpoint.cloud("https://cloud.openclaw.ai/api"))
    assertNull(GatewayEndpoint.cloud("https://cloud.openclaw.ai/?a=1"))
  }
}
