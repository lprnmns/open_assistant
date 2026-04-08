package ai.openclaw.app.ui

import ai.openclaw.app.gateway.GatewayEndpoint

internal enum class CloudAuthMode {
  Register,
  Login,
}

internal fun cloudGatewayAddress(rawBaseUrl: String): String? {
  val endpoint = GatewayEndpoint.cloud(rawBaseUrl) ?: return null
  val scheme = if (endpoint.tlsEnabled) "https" else "http"
  return "$scheme://${endpoint.host}:${endpoint.port}"
}
