package ai.openclaw.app.reminder

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderReconcilerTest {
  @Test
  fun reconcileCancelsOrphansAndSchedulesRemoteOneShotReminders() {
    val nowMs = 1_700_000_000_000L
    val scheduler =
      FakeReconcilerScheduler(
        pending =
          mutableListOf(
            scheduledReminder(
              id = "local-orphan",
              cronJobId = "remote-orphan",
              dueAtMs = nowMs + 10_000,
            ),
          ),
      )
    val reconciler =
      ReminderReconciler(
        scheduler = scheduler,
        requestCronList = {
          """
          {
            "jobs": [
              {
                "id": "remote-1",
                "name": "Exam reminder",
                "schedule": { "kind": "at", "at": "2023-11-14T23:13:20Z" },
                "payload": { "kind": "systemEvent", "text": "Bring your calculator." }
              },
              {
                "id": "remote-recurring",
                "name": "Ignore recurring",
                "schedule": { "kind": "every", "everyMs": 60000 },
                "payload": { "kind": "systemEvent", "text": "Not a one-shot reminder." }
              }
            ]
          }
          """.trimIndent()
        },
        clock = { nowMs },
      )

    runBlocking { reconciler.reconcile() }

    assertEquals(listOf("local-orphan"), scheduler.canceledIds)
    assertEquals(1, scheduler.scheduledRequests.size)
    assertEquals("remote-1", scheduler.scheduledRequests.single().id)
    assertEquals("Exam reminder", scheduler.scheduledRequests.single().title)
    assertEquals("Bring your calculator.", scheduler.scheduledRequests.single().body)
    assertEquals("exact", scheduler.scheduledRequests.single().precision)
  }

  @Test
  fun reconcileStripsReminderContextAndUsesSoftPrecisionForDistantJobs() {
    val nowMs = 1_700_000_000_000L
    val scheduler = FakeReconcilerScheduler()
    val reconciler =
      ReminderReconciler(
        scheduler = scheduler,
        requestCronList = {
          """
          {
            "jobs": [
              {
                "id": "remote-2",
                "name": "Deep work",
                "schedule": { "kind": "at", "at": "2023-11-15T06:13:20Z" },
                "payload": {
                  "kind": "systemEvent",
                  "text": "Focus block\n\nRecent context:\n- User: prepare the deck"
                }
              },
              {
                "id": "remote-past",
                "name": "Past reminder",
                "schedule": { "kind": "at", "at": "2023-11-14T22:00:00Z" },
                "payload": { "kind": "systemEvent", "text": "Too late." }
              },
              {
                "id": "remote-agent",
                "name": "Agent job",
                "schedule": { "kind": "at", "at": "2023-11-15T07:13:20Z" },
                "payload": { "kind": "agentTurn", "message": "ignored" }
              }
            ]
          }
          """.trimIndent()
        },
        clock = { nowMs },
      )

    runBlocking { reconciler.reconcile() }

    assertTrue(scheduler.canceledIds.isEmpty())
    assertEquals(1, scheduler.scheduledRequests.size)
    val request = scheduler.scheduledRequests.single()
    assertEquals("remote-2", request.id)
    assertEquals("Focus block", request.body)
    assertEquals("soft", request.precision)
  }
}

private class FakeReconcilerScheduler(
  pending: MutableList<ScheduledReminderEntity> = mutableListOf(),
) : ReminderScheduler {
  private val reminders = pending

  val scheduledRequests = mutableListOf<ReminderScheduleRequest>()
  val canceledIds = mutableListOf<String>()

  override fun schedule(request: ReminderScheduleRequest) {
    scheduledRequests += request
    reminders.removeAll { it.id == request.id }
    reminders +=
      ScheduledReminderEntity(
        id = request.id,
        title = request.title,
        body = request.body,
        dueAtMs = request.dueAtMs,
        precision = request.precision,
        priority = request.priority,
        cronJobId = request.cronJobId,
        createdAtMs = request.createdAtMs,
      )
  }

  override fun cancel(id: String) {
    canceledIds += id
    reminders.removeAll { it.id == id }
  }

  override fun listPending(nowMs: Long): List<ScheduledReminderEntity> =
    reminders.filter { it.dueAtMs > nowMs }
}

private fun scheduledReminder(
  id: String,
  cronJobId: String?,
  dueAtMs: Long,
): ScheduledReminderEntity =
  ScheduledReminderEntity(
    id = id,
    title = "Local reminder",
    body = "Existing reminder",
    dueAtMs = dueAtMs,
    precision = "soft",
    priority = "active",
    cronJobId = cronJobId,
    createdAtMs = dueAtMs - 1_000,
  )
