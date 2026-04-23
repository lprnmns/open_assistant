package ai.openclaw.app.node

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import ai.openclaw.app.gateway.GatewaySession
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

private const val DEFAULT_APPS_LIST_LIMIT = 50
private const val DEFAULT_APPS_RESOLVE_LIMIT = 8

internal data class LaunchableAppRecord(
  val label: String,
  val packageName: String,
  val activityName: String,
)

internal data class AppsQueryRequest(
  val query: String?,
  val limit: Int,
)

internal interface AppsDataSource {
  fun listLaunchableApps(context: Context): List<LaunchableAppRecord>
}

internal object SystemAppsDataSource : AppsDataSource {
  override fun listLaunchableApps(context: Context): List<LaunchableAppRecord> {
    val packageManager = context.packageManager
    val launcherIntent =
      Intent(Intent.ACTION_MAIN).apply {
        addCategory(Intent.CATEGORY_LAUNCHER)
      }
    val resolved =
      if (Build.VERSION.SDK_INT >= 33) {
        packageManager.queryIntentActivities(
          launcherIntent,
          PackageManager.ResolveInfoFlags.of(0),
        )
      } else {
        @Suppress("DEPRECATION")
        packageManager.queryIntentActivities(launcherIntent, 0)
      }

    return resolved
      .asSequence()
      .mapNotNull { info ->
        val activityInfo = info.activityInfo ?: return@mapNotNull null
        val packageName = activityInfo.packageName?.trim().orEmpty()
        val activityName = activityInfo.name?.trim().orEmpty()
        if (packageName.isEmpty() || activityName.isEmpty()) {
          return@mapNotNull null
        }
        val label =
          info
            .loadLabel(packageManager)
            ?.toString()
            ?.replace(Regex("\\s+"), " ")
            ?.trim()
            ?.ifEmpty { null }
            ?: packageName
        LaunchableAppRecord(
          label = label,
          packageName = packageName,
          activityName = activityName,
        )
      }
      .distinctBy { "${it.packageName}/${it.activityName}" }
      .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.label })
      .toList()
  }
}

class AppsHandler private constructor(
  private val appContext: Context,
  private val dataSource: AppsDataSource,
) {
  constructor(appContext: Context) : this(appContext = appContext, dataSource = SystemAppsDataSource)

  fun handleAppsList(paramsJson: String?): GatewaySession.InvokeResult {
    val request =
      parseRequest(paramsJson, defaultLimit = DEFAULT_APPS_LIST_LIMIT)
        ?: return invalidRequest()
    return try {
      val apps = filterAndRankApps(dataSource.listLaunchableApps(appContext), request).take(request.limit)
      GatewaySession.InvokeResult.ok(
        buildJsonObject {
          put("count", JsonPrimitive(apps.size))
          put("apps", buildJsonArray { apps.forEach { add(appJson(it)) } })
        }.toString(),
      )
    } catch (err: Throwable) {
      GatewaySession.InvokeResult.error(
        code = "APPS_UNAVAILABLE",
        message = "APPS_UNAVAILABLE: ${err.message ?: "apps query failed"}",
      )
    }
  }

  fun handleAppsResolve(paramsJson: String?): GatewaySession.InvokeResult {
    val request =
      parseRequest(paramsJson, defaultLimit = DEFAULT_APPS_RESOLVE_LIMIT)
        ?: return invalidRequest()
    if (request.query.isNullOrBlank()) {
      return invalidRequest("INVALID_REQUEST: query required")
    }
    return try {
      val candidates = filterAndRankApps(dataSource.listLaunchableApps(appContext), request).take(request.limit)
      GatewaySession.InvokeResult.ok(
        buildJsonObject {
          put("query", JsonPrimitive(request.query))
          val bestMatch = candidates.firstOrNull()
          if (bestMatch == null) {
            put("bestMatch", JsonNull)
          } else {
            put("bestMatch", appJson(bestMatch))
          }
          put("candidates", buildJsonArray { candidates.forEach { add(appJson(it)) } })
        }.toString(),
      )
    } catch (err: Throwable) {
      GatewaySession.InvokeResult.error(
        code = "APPS_UNAVAILABLE",
        message = "APPS_UNAVAILABLE: ${err.message ?: "apps query failed"}",
      )
    }
  }

  private fun parseRequest(paramsJson: String?, defaultLimit: Int): AppsQueryRequest? {
    if (paramsJson.isNullOrBlank()) {
      return AppsQueryRequest(query = null, limit = defaultLimit)
    }
    val params =
      try {
        Json.parseToJsonElement(paramsJson) as? JsonObject
      } catch (_: Throwable) {
        null
      } ?: return null
    val query = params.stringParam("query")?.ifBlank { null }
    val limit = (params["limit"]?.jsonPrimitive?.intOrNull ?: defaultLimit).coerceIn(1, 200)
    return AppsQueryRequest(query = query, limit = limit)
  }

  private fun invalidRequest(message: String = "INVALID_REQUEST: expected JSON object"): GatewaySession.InvokeResult =
    GatewaySession.InvokeResult.error(
      code = "INVALID_REQUEST",
      message = message,
    )

  companion object {
    internal fun forTesting(
      appContext: Context,
      dataSource: AppsDataSource,
    ): AppsHandler = AppsHandler(appContext = appContext, dataSource = dataSource)
  }
}

internal fun filterAndRankApps(
  apps: List<LaunchableAppRecord>,
  request: AppsQueryRequest,
): List<LaunchableAppRecord> {
  val query = request.query?.let(::normalizeAppSearchText).orEmpty()
  if (query.isEmpty()) {
    return apps.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.label })
  }
  return apps
    .mapNotNull { app ->
      val score = appSearchScore(app, query) ?: return@mapNotNull null
      score to app
    }
    .sortedWith(
      compareBy<Pair<Int, LaunchableAppRecord>> { it.first }
        .thenBy(String.CASE_INSENSITIVE_ORDER) { it.second.label }
        .thenBy { it.second.packageName },
    )
    .map { it.second }
}

internal fun resolveLaunchableApp(
  apps: List<LaunchableAppRecord>,
  target: String,
): LaunchableAppRecord? {
  val trimmedTarget = target.trim()
  if (trimmedTarget.isEmpty()) {
    return null
  }
  apps
    .firstOrNull { app -> app.packageName.equals(trimmedTarget, ignoreCase = true) }
    ?.let { return it }
  return filterAndRankApps(
    apps = apps,
    request = AppsQueryRequest(query = trimmedTarget, limit = 1),
  ).firstOrNull()
}

private fun appSearchScore(app: LaunchableAppRecord, normalizedQuery: String): Int? {
  val label = normalizeAppSearchText(app.label)
  val packageName = normalizeAppSearchText(app.packageName)
  val activityName = normalizeAppSearchText(app.activityName)
  return when {
    label == normalizedQuery || packageName == normalizedQuery -> 0
    label.startsWith(normalizedQuery) || packageName.startsWith(normalizedQuery) -> 1
    label.contains(normalizedQuery) || packageName.contains(normalizedQuery) -> 2
    activityName.contains(normalizedQuery) -> 3
    else -> null
  }
}

private fun normalizeAppSearchText(value: String): String =
  value
    .lowercase(Locale.ROOT)
    .replace(Regex("[^a-z0-9ığüşöçİĞÜŞÖÇ]+"), " ")
    .replace(Regex("\\s+"), " ")
    .trim()

private fun appJson(app: LaunchableAppRecord): JsonObject =
  buildJsonObject {
    put("label", JsonPrimitive(app.label))
    put("packageName", JsonPrimitive(app.packageName))
    put("activityName", JsonPrimitive(app.activityName))
  }

private fun JsonObject.stringParam(key: String): String? =
  get(key)?.jsonPrimitive?.contentOrNull?.trim()
