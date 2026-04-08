package ai.openclaw.app.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class CloudAccount(
  val id: String?,
  val email: String?,
)

data class AccountAuthSuccess(
  val token: String,
  val account: CloudAccount,
)

class AccountAuthException(message: String) : IllegalStateException(message)

class AccountAuthClient(
  private val httpClient: OkHttpClient = OkHttpClient(),
  private val json: Json = Json { ignoreUnknownKeys = true },
) {
  suspend fun register(
    baseUrl: String,
    email: String,
    password: String,
    inviteCode: String? = null,
  ): AccountAuthSuccess =
    sendAuthRequest(
      url = "${normalizeBaseUrl(baseUrl)}/auth/register",
      bodyJson =
        buildJsonObject {
          put("email", email.trim())
          put("password", password)
          inviteCode?.trim()?.takeIf { it.isNotEmpty() }?.let { put("inviteCode", it) }
        }.toString(),
    )

  suspend fun login(
    baseUrl: String,
    email: String,
    password: String,
  ): AccountAuthSuccess =
    sendAuthRequest(
      url = "${normalizeBaseUrl(baseUrl)}/auth/login",
      bodyJson =
        buildJsonObject {
          put("email", email.trim())
          put("password", password)
        }.toString(),
    )

  private suspend fun sendAuthRequest(
    url: String,
    bodyJson: String,
  ): AccountAuthSuccess =
    withContext(Dispatchers.IO) {
      val request =
        Request.Builder()
          .url(url)
          .post(bodyJson.toRequestBody("application/json; charset=utf-8".toMediaType()))
          .header("Content-Type", "application/json")
          .build()
      httpClient.newCall(request).execute().use { response ->
        val bodyText = response.body?.string().orEmpty()
        val root = bodyText.parseJsonObjectOrNull(json)
        if (!response.isSuccessful) {
          val message = root?.getObject("error")?.getString("message") ?: "authentication failed"
          throw AccountAuthException(message)
        }

        val token = root?.getString("token")?.trim().orEmpty()
        if (token.isEmpty()) {
          throw AccountAuthException("authentication token missing from response")
        }
        val account = root.getObject("account")
        AccountAuthSuccess(
          token = token,
          account =
            CloudAccount(
              id = account?.getString("id"),
              email = account?.getString("email"),
            ),
        )
      }
    }

  private fun normalizeBaseUrl(raw: String): String {
    val trimmed = raw.trim().trimEnd('/')
    require(trimmed.isNotEmpty()) { "baseUrl is required" }
    return trimmed
  }
}

private fun String.parseJsonObjectOrNull(json: Json): JsonObject? =
  runCatching { json.parseToJsonElement(this) as? JsonObject }.getOrNull()

private fun JsonObject?.getObject(key: String): JsonObject? = this?.get(key) as? JsonObject

private fun JsonObject?.getString(key: String): String? = (this?.get(key) as? JsonPrimitive)?.content
