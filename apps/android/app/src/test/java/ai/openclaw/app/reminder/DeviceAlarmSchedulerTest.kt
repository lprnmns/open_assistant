package ai.openclaw.app.reminder

import ai.openclaw.app.node.NodeHandlerRobolectricTest
import androidx.room.Room
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.ConscryptMode

@RunWith(RobolectricTestRunner::class)
@ConscryptMode(ConscryptMode.Mode.OFF)
class DeviceAlarmSchedulerTest : NodeHandlerRobolectricTest() {
  private lateinit var database: ReminderDatabase
  private lateinit var registrar: FakeReminderAlarmRegistrar
  private lateinit var scheduler: DeviceAlarmScheduler

  @Before
  fun setUp() {
    database =
      Room.inMemoryDatabaseBuilder(appContext(), ReminderDatabase::class.java)
        .allowMainThreadQueries()
        .build()
    registrar = FakeReminderAlarmRegistrar()
    scheduler =
      DeviceAlarmScheduler(
        appContext = appContext(),
        database = database,
        registrar = registrar,
      )
  }

  @After
  fun tearDown() {
    database.close()
  }

  @Test
  fun schedule_usesExactAlarmWhenAllowed() {
    registrar.exactAlarmsAllowed = true

    scheduler.schedule(
      ReminderScheduleRequest(
        id = "exam-1",
        title = "Exam",
        body = "2 hours left",
        dueAtMs = 1_000,
        precision = "exact",
        priority = "active",
        cronJobId = "cron-1",
        createdAtMs = 100,
      ),
    )

    assertEquals(listOf("exam-1"), registrar.exactIds)
    assertEquals(emptyList<String>(), registrar.softIds)
  }

  @Test
  fun schedule_fallsBackToSoftWhenExactAlarmUnavailable() {
    registrar.exactAlarmsAllowed = false

    scheduler.schedule(
      ReminderScheduleRequest(
        id = "exam-1",
        title = "Exam",
        body = "2 hours left",
        dueAtMs = 1_000,
        precision = "exact",
        priority = null,
        cronJobId = null,
        createdAtMs = 100,
      ),
    )

    assertEquals(emptyList<String>(), registrar.exactIds)
    assertEquals(listOf("exam-1"), registrar.softIds)
  }

  @Test
  fun restorePending_reRegistersFutureRemindersAndDeletesExpiredOnes() {
    scheduler.schedule(
      ReminderScheduleRequest(
        id = "expired",
        title = "Expired",
        body = "Old",
        dueAtMs = 100,
        precision = "soft",
        priority = null,
        cronJobId = null,
        createdAtMs = 50,
      ),
    )
    scheduler.schedule(
      ReminderScheduleRequest(
        id = "upcoming",
        title = "Upcoming",
        body = "New",
        dueAtMs = 500,
        precision = "soft",
        priority = null,
        cronJobId = "cron-2",
        createdAtMs = 200,
      ),
    )
    registrar.reset()

    scheduler.restorePending(nowMs = 200)

    assertEquals(listOf("upcoming"), registrar.softIds)
    assertNull(runBlocking { database.reminderDao().getById("expired") })
  }
}

private class FakeReminderAlarmRegistrar : ReminderAlarmRegistrar {
  var exactAlarmsAllowed: Boolean = false
  val exactIds = mutableListOf<String>()
  val softIds = mutableListOf<String>()
  val cancelledIds = mutableListOf<String>()

  override fun canScheduleExactAlarms(): Boolean = exactAlarmsAllowed

  override fun scheduleExact(id: String, dueAtMs: Long, pendingIntent: android.app.PendingIntent) {
    exactIds += id
  }

  override fun scheduleSoft(id: String, dueAtMs: Long, pendingIntent: android.app.PendingIntent) {
    softIds += id
  }

  override fun cancel(id: String, pendingIntent: android.app.PendingIntent) {
    cancelledIds += id
  }

  fun reset() {
    exactIds.clear()
    softIds.clear()
    cancelledIds.clear()
  }
}
