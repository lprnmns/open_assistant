package ai.openclaw.app.node

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.ConscryptMode

@RunWith(RobolectricTestRunner::class)
@ConscryptMode(ConscryptMode.Mode.OFF)
class AppsHandlerTest {
  @Test
  fun handleAppsList_filtersLaunchableAppsByQuery() {
    val handler = AppsHandler.forTesting(appContext(), FakeAppsDataSource(sampleApps()))

    val result = handler.handleAppsList("""{"query":"insta","limit":5}""")

    assertTrue(result.ok)
    val apps = parsePayload(result.payloadJson).getValue("apps").jsonArray
    assertEquals(1, apps.size)
    assertEquals("Instagram", apps[0].jsonObject.getValue("label").jsonPrimitive.content)
    assertEquals("com.instagram.android", apps[0].jsonObject.getValue("packageName").jsonPrimitive.content)
  }

  @Test
  fun handleAppsResolve_returnsBestMatchAndCandidates() {
    val handler = AppsHandler.forTesting(appContext(), FakeAppsDataSource(sampleApps()))

    val result = handler.handleAppsResolve("""{"query":"gram","limit":5}""")

    assertTrue(result.ok)
    val payload = parsePayload(result.payloadJson)
    val bestMatch = payload.getValue("bestMatch").jsonObject
    assertEquals("Instagram", bestMatch.getValue("label").jsonPrimitive.content)
    assertEquals("com.instagram.android", bestMatch.getValue("packageName").jsonPrimitive.content)
    assertEquals(1, payload.getValue("candidates").jsonArray.size)
  }

  @Test
  fun handleAppsResolve_rejectsBlankQuery() {
    val handler = AppsHandler.forTesting(appContext(), FakeAppsDataSource(sampleApps()))

    val result = handler.handleAppsResolve("""{"query":"   "}""")

    assertEquals(false, result.ok)
    assertEquals("INVALID_REQUEST", result.error?.code)
  }

  @Test
  fun resolveLaunchableApp_prefersExactPackageName() {
    val app = resolveLaunchableApp(sampleApps(), "com.google.android.calendar")

    assertEquals("Google Calendar", app?.label)
    assertEquals("com.google.android.calendar", app?.packageName)
  }

  @Test
  fun resolveLaunchableApp_resolvesHumanReadableAppName() {
    val app = resolveLaunchableApp(sampleApps(), "insta")

    assertEquals("Instagram", app?.label)
    assertEquals("com.instagram.android", app?.packageName)
  }

  private fun sampleApps(): List<LaunchableAppRecord> =
    listOf(
      LaunchableAppRecord(
        label = "Instagram",
        packageName = "com.instagram.android",
        activityName = "com.instagram.mainactivity.InstagramMainActivity",
      ),
      LaunchableAppRecord(
        label = "Google Calendar",
        packageName = "com.google.android.calendar",
        activityName = "com.android.calendar.AllInOneActivity",
      ),
    )

  private fun appContext(): Context = RuntimeEnvironment.getApplication()

  private fun parsePayload(payloadJson: String?): JsonObject {
    val jsonString = payloadJson ?: error("expected payload")
    return Json.parseToJsonElement(jsonString).jsonObject
  }

  private class FakeAppsDataSource(
    private val apps: List<LaunchableAppRecord>,
  ) : AppsDataSource {
    override fun listLaunchableApps(context: Context): List<LaunchableAppRecord> = apps
  }
}
