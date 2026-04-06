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
class ReminderDatabaseTest : NodeHandlerRobolectricTest() {
  private lateinit var database: ReminderDatabase
  private lateinit var dao: ReminderDao

  @Before
  fun setUp() {
    database =
      Room.inMemoryDatabaseBuilder(appContext(), ReminderDatabase::class.java)
        .allowMainThreadQueries()
        .build()
    dao = database.reminderDao()
  }

  @After
  fun tearDown() {
    database.close()
  }

  @Test
  fun upsertPersistsReminder() =
    runBlocking {
      val reminder =
        ScheduledReminderEntity(
          id = "exam-1",
          title = "Math exam",
          body = "2 hours left",
          dueAtMs = 1_744_657_200_000,
          precision = "exact",
          priority = "active",
          cronJobId = "cron-1",
          createdAtMs = 1_744_650_000_000,
        )

      dao.upsert(reminder)

      assertEquals(reminder, dao.getById("exam-1"))
      assertEquals(listOf(reminder), dao.getAllPending(1_744_650_000_001))
    }

  @Test
  fun deleteExpiredRemindersOnlyRemovesPastEntries() =
    runBlocking {
      val expired =
        ScheduledReminderEntity(
          id = "expired",
          title = "Old reminder",
          body = "Expired",
          dueAtMs = 100,
          precision = "soft",
          priority = null,
          cronJobId = null,
          createdAtMs = 50,
        )
      val upcoming =
        ScheduledReminderEntity(
          id = "upcoming",
          title = "Upcoming reminder",
          body = "Still valid",
          dueAtMs = 500,
          precision = "exact",
          priority = null,
          cronJobId = "cron-2",
          createdAtMs = 200,
        )

      dao.upsert(expired)
      dao.upsert(upcoming)
      dao.deleteExpired(200)

      assertNull(dao.getById("expired"))
      assertEquals(listOf(upcoming), dao.getAll())
    }
}
