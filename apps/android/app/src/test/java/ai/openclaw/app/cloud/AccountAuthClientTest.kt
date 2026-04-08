package ai.openclaw.app.cloud

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountAuthClientTest {
  @Test
  fun register_postsJsonAndReturnsToken() = runBlocking {
    val server = MockWebServer()
    server.enqueue(
      MockResponse().setResponseCode(200).setBody(
        """{"ok":true,"token":"acct_token_123","account":{"id":"user-1","email":"cloud@example.com"}}""",
      ),
    )
    server.start()

    try {
      val client = AccountAuthClient()
      val result =
        client.register(
          baseUrl = server.url("/").toString(),
          email = " cloud@example.com ",
          password = "password-123",
          inviteCode = " invite-1 ",
        )

      val request = server.takeRequest()
      val requestBody = request.body.readUtf8()
      assertEquals("/auth/register", request.path)
      assertEquals("POST", request.method)
      assertTrue(requestBody.contains(""""email":"cloud@example.com""""))
      assertTrue(requestBody.contains(""""inviteCode":"invite-1""""))
      assertEquals("acct_token_123", result.token)
      assertEquals("user-1", result.account.id)
      assertEquals("cloud@example.com", result.account.email)
    } finally {
      server.shutdown()
    }
  }

  @Test
  fun login_postsJsonAndReturnsToken() = runBlocking {
    val server = MockWebServer()
    server.enqueue(
      MockResponse().setResponseCode(200).setBody(
        """{"ok":true,"token":"acct_token_456","account":{"id":"user-2","email":"returning@example.com"}}""",
      ),
    )
    server.start()

    try {
      val client = AccountAuthClient()
      val result =
        client.login(
          baseUrl = server.url("/api/").toString(),
          email = "returning@example.com",
          password = "password-456",
        )

      val request = server.takeRequest()
      val requestBody = request.body.readUtf8()
      assertEquals("/api/auth/login", request.path)
      assertEquals("POST", request.method)
      assertTrue(requestBody.contains(""""password":"password-456""""))
      assertEquals("acct_token_456", result.token)
      assertEquals("user-2", result.account.id)
    } finally {
      server.shutdown()
    }
  }

  @Test
  fun register_usesServerErrorMessageWhenPresent() = runBlocking {
    val server = MockWebServer()
    server.enqueue(
      MockResponse().setResponseCode(403).setBody(
        """{"error":{"message":"A valid invite code is required.","type":"forbidden"}}""",
      ),
    )
    server.start()

    try {
      val client = AccountAuthClient()
      val error =
        try {
          client.register(
            baseUrl = server.url("/").toString(),
            email = "cloud@example.com",
            password = "password-123",
            inviteCode = "bad-code",
          )
          null
        } catch (err: AccountAuthException) {
          err
        }
      requireNotNull(error)
      assertEquals("A valid invite code is required.", error.message)
    } finally {
      server.shutdown()
    }
  }
}
