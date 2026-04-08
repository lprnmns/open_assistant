package ai.openclaw.app.gateway

import java.net.URI

data class GatewayEndpoint(
  val stableId: String,
  val name: String,
  val host: String,
  val port: Int,
  val lanHost: String? = null,
  val tailnetDns: String? = null,
  val gatewayPort: Int? = null,
  val canvasPort: Int? = null,
  val tlsEnabled: Boolean = false,
  val tlsFingerprintSha256: String? = null,
) {
  companion object {
    fun manual(host: String, port: Int): GatewayEndpoint =
      GatewayEndpoint(
        stableId = "manual|${host.lowercase()}|$port",
        name = "$host:$port",
        host = host,
        port = port,
        tlsEnabled = false,
        tlsFingerprintSha256 = null,
      )

    fun cloud(baseUrl: String): GatewayEndpoint? {
      val trimmed = baseUrl.trim()
      if (trimmed.isEmpty()) return null
      val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
      val scheme = uri.scheme?.trim()?.lowercase() ?: return null
      if (scheme != "http" && scheme != "https") return null
      val host = uri.host?.trim()?.takeIf { it.isNotEmpty() } ?: return null
      val path = uri.rawPath?.trim().orEmpty()
      if (path.isNotEmpty() && path != "/") return null
      if (!uri.rawQuery.isNullOrBlank() || !uri.rawFragment.isNullOrBlank()) return null
      val port = if (uri.port > 0) uri.port else if (scheme == "https") 443 else 80
      return GatewayEndpoint(
        stableId = "cloud|$scheme|${host.lowercase()}|$port",
        name = host,
        host = host,
        port = port,
        tlsEnabled = scheme == "https",
        tlsFingerprintSha256 = null,
      )
    }
  }
}
