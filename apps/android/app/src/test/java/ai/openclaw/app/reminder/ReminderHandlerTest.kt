package ai.openclaw.app.reminder

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderHandlerTest {
  @Test
  fun handleReminderSchedule_requiresId() {
    val handler = ReminderHandler.forTesting(scheduler = FakeReminderScheduler())

    val result = handler.handleReminderSchedule("""{"title":"Exam","body":"Soon","dueAtMs":1000}""")

    assertFalse(result.ok)
    assertEquals("INVALID_REQUEST", result.error?.code)
  }

  @Test
  fun handleReminderSchedule_delegatesToScheduler() {
    val scheduler = FakeReminderScheduler()
    val handler = ReminderHandler.forTesting(scheduler = scheduler, clock = { 50 })

    val result =
      handler.handleReminderSchedule(
        """{"id":"exam-1","title":"Exam","body":"2 hours left","dueAtMs":1000,"precision":"soft","priority":"active","cronJobId":"cron-1"}""",
      )

    assertTrue(result.ok)
    assertEquals(
      ReminderScheduleRequest(
        id = "exam-1",
        title = "Exam",
        body = "2 hours left",
        dueAtMs = 1000,
        precision = "soft",
        priority = "active",
        cronJobId = "cron-1",
        createdAtMs = 50,
      ),
      scheduler.scheduled.single(),
    )
  }

  @Test
  fun handleReminderCancel_delegatesToScheduler() {
    val scheduler = FakeReminderScheduler()
    val handler = ReminderHandler.forTesting(scheduler = scheduler)

    val result = handler.handleReminderCancel("""{"id":"exam-1"}""")

    assertTrue(result.ok)
    assertEquals(listOf("exam-1"), scheduler.cancelled)
  }

  @Test
  fun handleReminderList_returnsSerializedPendingReminders() {
    val scheduler =
      FakeReminderScheduler(
        reminders =
          listOf(
            ScheduledReminderEntity(
              id = "exam-1",
              title = "Exam",
              body = "2 hours left",
              dueAtMs = 1_000,
              precision = "soft",
              priority = "active",
              cronJobId = "cron-1",
              createdAtMs = 500,
            ),
          ),
      )
    val handler = ReminderHandler.forTesting(scheduler = scheduler, clock = { 200 })

    val result = handler.handleReminderList(null)

    assertTrue(result.ok)
    val payload = Json.parseToJsonElement(result.payloadJson ?: error("missing payload")).jsonObject
    val reminders = payload.getValue("reminders").jsonArray
    assertEquals(1, reminders.size)
    assertEquals("exam-1", reminders.first().jsonObject.getValue("id").jsonPrimitive.content)
    assertEquals(listOf(200L), scheduler.listCalls)
  }
}

private class FakeReminderScheduler(
  private val reminders: List<ScheduledReminderEntity> = emptyList(),
) : ReminderScheduler {
  val scheduled = mutableListOf<ReminderScheduleRequest>()
  val cancelled = mutableListOf<String>()
  val listCalls = mutableListOf<Long>()

  override fun schedule(request: ReminderScheduleRequest) {
    scheduled += request
  }

  override fun cancel(id: String) {
    cancelled += id
  }

  override fun listPending(nowMs: Long): List<ScheduledReminderEntity> {
    listCalls += nowMs
    return reminders
  }
}
