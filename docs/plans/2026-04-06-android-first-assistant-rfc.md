# RFC: Android-First Personal AI Assistant

- **Status:** Approved
- **Date:** 2026-04-06
- **Architecture:** Hybrid — Hosted Assistant Core + Android Device Action Bridge

---

## 1. Architecture

```
Hosted Assistant Core (team-operated cloud, Node.js/TypeScript)
  LLM orchestration (agent-runner, tool pipeline)
  Consciousness loop (sleep/wake/consolidation)
  Living Brain (Cortex + Hippocampus, SQLite)
  Cron store (scheduling source of truth)
  PDF OCR + text extraction
  Reminder commitment detection (EN + TR)
  Session / interaction persistence
  Multi-user session isolation + account auth
  Upload endpoint (staged file transport)

    ↕ WebSocket (existing node protocol)

Android App (user device, Kotlin/Jetpack Compose)
  Chat UI + streaming
  Device Alarm Layer (exact + soft, two-tier AlarmManager)
  CalendarHandler (native CalendarContract read/write)
  SystemHandler (native notification post via system.notify)
  NotificationsHandler (device notification read/dismiss/reply)
  InvokeDispatcher (central command router)
  NodeForegroundService (persistent foreground service)
  GatewaySession (WebSocket RPC, auto-reconnect, device auth)
  PermissionRequester (contextual rationale dialogs)
  Voice (SpeechRecognizer + TTS)
```

---

## 2. Rationale

### Why not full local-first
Consciousness loop, Living Brain, cron scheduler, PDF OCR, agent tool pipeline total ~15K lines of mature TypeScript. Rewriting in Kotlin delivers zero user value. On-device LLMs cannot handle complex document understanding or long-context memory today.

### Why not pure thin-client
Thin-client reminders depend entirely on push notifications (FCM). App kill + network loss = lost reminder. The product promise ("if it commits, it follows through") requires durable device-local alarms.

### Why hybrid
- Hosted core: intelligence, memory, OCR, scheduling source of truth — existing TS core transfers with near-zero changes
- Android device layer: durable alarms, native calendar, native notifications, file picker — uses device capabilities directly
- Existing WebSocket node protocol bridges the two — already working

### Why AlarmManager, not WorkManager
- WorkManager execution windows drift up to 15 minutes in Doze mode
- "Exam in 2 hours" reminder with ±15min drift is unacceptable
- `AlarmManager.setExactAndAllowWhileIdle()` fires at the scheduled second even in Doze
- WorkManager's periodic/deferrable semantics are unnecessary — every alarm is one-shot; reconciliation runs explicitly on reconnect

---

## 3. Core Concept: `DeliveryTarget`

Replaces the broken `activeChannelId` field (currently records provider label like `"telegram"` instead of actual route ID).

```typescript
type DeliveryTarget = {
  kind: "node" | "channel" | "none";
  id: string;              // node instanceId or channel conversation ID
  nodeId?: string;         // gateway-assigned node connection ID (kind=node)
  channelType?: string;    // "telegram" | "discord" | "web" | "signal" (kind=channel)
  label?: string;          // human-readable: "Pixel 8", "Telegram @user"
};
```

Design decisions:
- `kind` is transport-class, not per-service. `"channel"` covers all messaging channels; `channelType` disambiguates.
- `"none"` means no active target — proactive messages are silently dropped (safe default).
- `capabilities` deliberately omitted from the type. The dispatch layer resolves capabilities from the node/channel registry at send time, not from the target struct. This avoids stale capability snapshots.

### Fix path

| File | Change |
|------|--------|
| `src/consciousness/interaction-tracker.ts` | `activeChannelId: string` → `activeDeliveryTarget: DeliveryTarget` |
| `src/auto-reply/dispatch.ts:44-46` | Build `DeliveryTarget` from OriginatingChannelType + OriginatingTo |
| `src/consciousness/integration.ts` | `sendToChannel()` → `sendToTarget(target, content)` |
| `src/consciousness/boot-lifecycle.ts` | Inject node-aware `sendToTarget` callback into dispatch context |
| `src/gateway/server-methods/chat.ts` | Update tracker with correct DeliveryTarget on inbound message |
| `src/consciousness/interaction-store.ts` | Persisted state shape: `activeChannelId` → `activeDeliveryTarget` |
| `src/consciousness/snapshot.ts` | WorldSnapshot: `activeChannelId`/`activeChannelType` → `activeDeliveryTarget` |

---

## 4. Two-Tier Alarm Strategy

| Tier | Mechanism | When | Precision | Battery |
|------|-----------|------|-----------|---------|
| Exact | `AlarmManager.setExactAndAllowWhileIdle()` | User gave explicit time: "saat 14:00", "2 saat sonra", exam reminder | ±seconds | Low (few per day) |
| Soft | `AlarmManager.setAndAllowWhileIdle()` | Vague nudge: "akşam tekrar bak", consciousness follow-up, weekly digest | ±15 min (Doze batching) | Minimal |

Decision logic:
- Hosted core sends `precision: "exact" | "soft"` in `reminder.schedule` command
- User gave explicit time → `exact`
- Consciousness proactive follow-up or vague time reference → `soft`
- `exact` requires `SCHEDULE_EXACT_ALARM` permission (Android 12+); if denied, silently falls back to `soft`
- Play Store `play` flavor: declare alarm/reminder use case in policy form; if rejected, ship with soft-only and keep exact in `thirdParty` flavor

### Alarm persistence
- Room DB stores all scheduled reminders (`ScheduledReminder` entity)
- `ReminderBootReceiver` (BOOT_COMPLETED) re-registers all pending alarms from Room on device restart
- `ReminderAlarmReceiver` fires → reads reminder from Room → posts notification via `SystemHandler`
- Entire alarm path is offline-capable: no hosted core connection required at fire time

---

## 5. PDF Transport Strategy

| Phase | Mechanism | Limit | Notes |
|-------|-----------|-------|-------|
| MVP | Base64 inline in `chat.send` attachment payload | 10 MB raw file | Existing `OutgoingAttachment` model works unchanged. Most exam PDFs are 1–5 MB. |
| Target | HTTP multipart POST to `/upload` endpoint on hosted core → staged file → `chat.send` carries `fileRef` ID | No practical limit | Progress bar in Android UI. Resume on failure possible. |

MVP: files >10 MB rejected with user message ("File too large — try a shorter document or take a photo").

### PDF → Calendar → Reminder data flow

```
Android                              Hosted Core
──────                              ────────────
User picks exam_schedule.pdf
  ↓
ChatDocumentCodec
  bytes → base64, size ≤10MB
  ↓
ChatController.sendMessage()
  OutgoingAttachment {
    type: "document"
    mimeType: "application/pdf"
    base64: "..."
  }
  ↓ chat.send ──────────────────→  agent-runner receives attachment
                                      ↓
                                    pdf-extract.ts (text extraction)
                                      if empty ↓
                                    pdf-ocr.ts (image → vision model OCR)
                                      ↓
                                    Agent reads extracted text
                                    Identifies: date, time, subject, room
                                    Confidence score per entry
                                      ↓ high confidence
                                    Calls calendar.add (per event)
                      ←──────────── node invoke: calendar.add
CalendarHandler.kt
  writes to device calendar
  returns confirmation
                      ──────────→
                                    Calls reminder.schedule (per event)
                                      2h before → precision: exact
                                      1d before → precision: soft
                      ←──────────── node invoke: reminder.schedule
DeviceAlarmScheduler
  exact: setExactAndAllowWhileIdle
  soft:  setAndAllowWhileIdle
  Room DB persists both
                                      ↓
                                    cron.add (source of truth,
                                      reconciliation anchor)
                                      ↓
                                    Agent replies: "3 exams added to
                                      calendar, reminders set"
                      ←──────────── chat event (reply in UI)

        ... time passes, app killed, device rebooted ...
        ReminderBootReceiver re-registers alarms from Room

[2 hours before exam]
  AlarmManager fires (exact)
  ReminderAlarmReceiver
    → Room DB lookup
    → SystemHandler.post(
        title: "Matematik 2 saat sonra"
        body: "09:00 — A-301"
        priority: "timesensitive")
  User sees notification
```

---

## 6. Provider Onboarding

### Primary flow: Managed provider (nontechnical users)
1. User opens app → "Get Started"
2. Account creation (email + password or invite code)
3. **Default provider pre-selected** — user does not choose a provider or enter keys
4. Managed provider uses team-operated API access; usage-based or subscription billing (product decision pending)
5. First message sent immediately after account creation

### Secondary flow: BYOK (advanced users)
1. User taps "Advanced" or "Use your own API key" in provider step
2. Provider picker: Claude, GPT, etc.
3. API key input field
4. Key validated before proceeding
5. All other flows identical

Design rule: managed path must work with zero technical decisions. BYOK is opt-in for users who already have API keys and want direct billing.

---

## 7. Proactive Notification Path

Consciousness loop decides `SEND_MESSAGE` → dispatch resolves `activeDeliveryTarget`:

| Target state | Delivery mechanism |
|-------------|-------------------|
| `kind: "node"`, connected, foreground | WebSocket `chat` event → appears in chat UI |
| `kind: "node"`, connected, background | Node invoke `system.notify` → native notification |
| `kind: "node"`, disconnected | Queue in interaction store → deliver on reconnect |
| `kind: "channel"` | Existing channel send path (Telegram, Discord, etc.) |
| `kind: "none"` | Silently drop — no target available |

Rate limiting:
- Max proactive notifications per day: configurable, default 5
- Minimum interval between proactive sends: configurable, default 2 hours
- User preference: proactive level (off / low / normal)

---

## 8. Multi-User Hosted Core Foundation

Required in Phase 0 to unblock real-user testing of all subsequent phases.

### MVP scope (Phase 0.3)
- Per-user directory: `data/users/<userId>/` containing sessions, cron store, consciousness state, memory store
- Account model: `{ id, email, hashedPassword, providerConfig, createdAt }`
- WebSocket auth: account token in connect handshake → user context resolved before any RPC
- Session isolation: each user gets own consciousness loop instance, cron store, Living Brain
- Invite-only registration for MVP (no public signup)

### Not in MVP scope
- Billing / usage metering
- Admin dashboard
- Account deletion / data export
- Horizontal scaling (single-process sufficient for early users)

---

## 9. Reusable Existing Assets

### Android — no changes needed

| File | Capability |
|------|-----------|
| `CalendarHandler.kt` | CalendarContract read/write, calendarId/title resolve |
| `SystemHandler.kt` | `system.notify` → native notification post (passive/active/timesensitive) |
| `DeviceNotificationListenerService.kt` | Device notification read, open/dismiss/reply |
| `NotificationsHandler.kt` | Notification snapshot + action dispatch |
| `InvokeDispatcher.kt` | Central command router, 20+ commands, extensible |
| `ChatController.kt` | Streaming chat, session switching, attachment payloads |
| `GatewaySession.kt` | WebSocket RPC, auto-reconnect, device token auth |
| `NodeForegroundService.kt` | START_STICKY foreground service |
| `PermissionRequester.kt` | Multi-permission request with rationale dialogs |
| `ChatModels.kt` | OutgoingAttachment supports arbitrary type/mimeType |
| `MainViewModel.kt` | Runtime lifecycle management |

### Hosted Core TypeScript — no changes needed

| File | Capability |
|------|-----------|
| `agent-runner-reminder-guard.ts` | NL reminder detection (EN + TR), cron.add auto-schedule |
| `cron-tool.ts` + `cron/store.ts` | Cron CRUD, at/interval schedule, deleteAfterRun |
| `pdf-ocr.ts` | Scanned PDF → image → vision model OCR |
| `pdf-extract.ts` | Text-based PDF extraction |
| `media-understanding/apply.ts` | Media pipeline orchestration |
| `consciousness/loop.ts` | Tick engine: SEND_MESSAGE / TAKE_NOTE / STAY_SILENT / ENTER_SLEEP |
| `consciousness/integration.ts` | Tick decision → side-effect dispatch |
| `consciousness/scheduler.ts` | Adaptive tick, consolidation trigger, event buffer |
| `consciousness/sleep/*` | Wake evaluation, consolidation, cycle guards |
| `consciousness/brain/*` | Cortex (episodic), Hippocampus (SQLite semantic recall) |
| `consciousness/events/buffer.ts` | Per-surface bounded event buffer, drain semantics |

---

## 10. New Code to Write

### Android

| Component | Type | Purpose |
|-----------|------|---------|
| `DeviceAlarmScheduler.kt` | New class | AlarmManager wrapper, Room persistence, exact/soft scheduling |
| `ReminderAlarmReceiver.kt` | New BroadcastReceiver | Fires on alarm → posts notification via SystemHandler |
| `ReminderBootReceiver.kt` | New BroadcastReceiver | BOOT_COMPLETED → re-registers alarms from Room |
| `ChatDocumentCodec.kt` | New utility | PDF URI → base64, size check (10MB limit) |
| `InvokeDispatcher.kt` | Extend | Add `reminder.schedule`, `reminder.cancel`, `reminder.list` routes |
| `ChatSheetContent.kt` | Extend | Add PDF file picker launcher (`"application/pdf"`) |
| `AndroidManifest.xml` | Extend | SCHEDULE_EXACT_ALARM, RECEIVE_BOOT_COMPLETED, receiver declarations |
| Onboarding UI | New screens | Cloud mode, account creation, managed provider default, BYOK option |

### Hosted Core

| Component | Type | Purpose |
|-----------|------|---------|
| DeliveryTarget type + tracker refactor | Refactor (7 files) | Replace broken activeChannelId with DeliveryTarget |
| Node-aware dispatch | New seam in boot-lifecycle | sendToTarget routes to system.notify for node targets |
| Reminder relay | Extend agent-runner-reminder-guard | After cron.add → also invoke reminder.schedule on node |
| Account model + auth | New module | User registration, login, token auth, per-user directories |
| Session isolation | New seam in config/sessions | Per-user consciousness instance, cron store, memory store |
| Upload endpoint | New HTTP route | POST /upload for staged file transport (target phase) |

---

## 11. Implementation Phases

### Phase 0 — Foundation

| Slice | Scope | Milestone |
|-------|-------|-----------|
| 0.1 | DeliveryTarget refactor (7 TS files, ~150-200 lines) | Tracker records correct route info, existing tests green |
| 0.2 | Node-aware proactive dispatch | Consciousness SEND_MESSAGE → Android native notification |
| 0.3 | Multi-user hosted core (account, isolation, auth) | 2 users on same core, isolated data |
| 0.4 | Android cloud onboarding (account UI, auto-connect) | New user connects without host/port knowledge |

### Phase 1 — Device Alarm Layer

| Slice | Scope | Milestone |
|-------|-------|-----------|
| 1.1 | DeviceAlarmScheduler + receivers + Room | reminder.schedule command → device alarm |
| 1.2 | Two-tier exact/soft wiring | Exact fires ±seconds, soft fires ±15min |
| 1.3 | Hosted core → device relay | NL "1 saat sonra hatırlat" → cron + device alarm |
| 1.4 | Reconnect reconciliation | 24h offline → reconnect → state consistent |

### Phase 2 — Document Intelligence

| Slice | Scope | Milestone |
|-------|-------|-----------|
| 2.1 | PDF file picker + base64 transport (10MB limit) | User sends PDF, assistant reads content |
| 2.2 | Structured extraction → calendar + reminder actions | Exam PDF → calendar events + alarms |
| 2.3 | Staged upload endpoint (no size limit) | Large PDFs upload with progress bar |

### Phase 3 — Proactive Notification Loop

| Slice | Scope | Milestone |
|-------|-------|-----------|
| 3.1 | Background/foreground/disconnected delivery routing | Assistant sends unprompted notification |
| 3.2 | Consciousness → soft alarm bridge | Follow-up plan survives app kill |
| 3.3 | FCM fallback (optional, not MVP-required) | Push reaches killed app |

### Phase 4 — Provider Selection & Polish

| Slice | Scope | Milestone |
|-------|-------|-----------|
| 4.1 | Provider picker (managed default, BYOK secondary) | User selects provider or uses default |
| 4.2 | Contextual permission requests | Permissions asked at first use, not upfront |
| 4.3 | Error message cleanup | No technical jargon in user-facing strings |

### Phase 5 — Memory Validation

| Slice | Scope | Milestone |
|-------|-------|-----------|
| 5.1 | Android-only consciousness tuning | Sleep/wake correct with sole Android surface |

### Phase 6 — Telegram Deprecation

| Slice | Scope | Milestone |
|-------|-------|-----------|
| 6.1 | Docs + policy: Android primary, Telegram legacy | New users directed to Android |

---

## 12. Acceptance Criteria

### Phase 0
- [ ] DeliveryTarget records `{ kind: "node", id }` for Android node messages
- [ ] DeliveryTarget records `{ kind: "channel", id, channelType: "telegram" }` for Telegram — no regression
- [ ] DeliveryTarget `{ kind: "none" }` silently drops proactive messages
- [ ] Consciousness SEND_MESSAGE → system.notify on Android node
- [ ] 2 users on same hosted core: isolated sessions, cron, consciousness, memory
- [ ] New user completes cloud onboarding without host/port/pairing

### Phase 1
- [ ] `reminder.schedule(precision: "exact")` → `setExactAndAllowWhileIdle`
- [ ] `reminder.schedule(precision: "soft")` → `setAndAllowWhileIdle`
- [ ] Exact alarm permission denied → silent fallback to soft
- [ ] App killed → exact alarm fires at correct time → notification appears
- [ ] Device restarted → pending alarms re-registered from Room DB
- [ ] NL "1 saat sonra hatırlat" → cron.add + reminder.schedule both fire
- [ ] Reconnect reconciliation: stale cleaned, missing re-created

### Phase 2
- [ ] PDF selectable from file picker
- [ ] PDF ≤10MB: base64 inline, hosted core processes
- [ ] PDF >10MB: rejected with user-facing message (MVP) / staged upload (target)
- [ ] Scanned PDF: OCR fallback works
- [ ] Agent extracts dates/subjects, proposes calendar events
- [ ] User confirms → calendar.add + reminder.schedule on device

### Phase 3
- [ ] Background: system.notify reaches device
- [ ] Foreground: chat event appears in UI
- [ ] Disconnected: queued, delivered on reconnect
- [ ] Rate limiting enforced (max/day, min interval)

### Phase 4
- [ ] Managed provider works with zero technical decisions
- [ ] BYOK accessible via "Advanced" path
- [ ] Permissions requested contextually at first use
- [ ] No "gateway", "node", "WebSocket" in user-facing strings

### Phase 5
- [ ] Consciousness sleep/wake/consolidation correct with Android-only surface
- [ ] No regression in existing test suites

---

## 13. Top 10 Risks

1. **Multi-user hosted core is the heaviest infrastructure work.** Session isolation, auth, per-user state directories. Moved to Phase 0 because everything downstream depends on it. Scope creep risk: MVP must be invite-only with minimal auth, not a full user management system.

2. **`SCHEDULE_EXACT_ALARM` Play Store policy.** Google may restrict this permission for non-alarm apps. Mitigation: declare alarm/reminder use case in policy form; `play` flavor can ship soft-only if exact is rejected; `thirdParty` flavor keeps exact.

3. **Cron ↔ AlarmManager sync edge cases.** Two state sources. Network timeout during sync, concurrent modification, hosted core cron deleted but device alarm lives. Reconciliation must be idempotent; hosted core is authoritative.

4. **PDF extraction quality varies.** Different formats, scanned vs digital, multi-language. Low confidence extractions must show user confirmation UI. Wrong exam date is trust-destroying.

5. **Proactive notification spam perception.** Too-frequent consciousness SEND_MESSAGE → user disables notifications or uninstalls. Rate limiting and user preference controls are required. Play Store policy penalizes aggressive notifications.

6. **Hosted core downtime = degraded app.** New messages, new reminders, PDF analysis all depend on hosted core. Existing local alarms continue to work. Graceful degradation UX needed: "Offline — previously scheduled reminders still active."

7. **Base64 10MB limit.** Sufficient for most exam PDFs but not for lecture notes or book chapters. Staged upload (Phase 2.3) should not be delayed beyond Phase 2.1 shipping.

8. **DeliveryTarget refactor touches 7 files.** Consciousness, interaction, snapshot tests will see shape changes. All existing tests must stay green within the same PR.

9. **Android Doze exact alarm throttling.** `setExactAndAllowWhileIdle` limited to ~1 per minute per app in Doze. Rapid exact alarm scenario (every 5 min) will be throttled. Enforce minimum interval in UX.

10. **Managed provider business model undefined.** Managed default path requires team-operated API access. Usage-based billing, subscription, or free tier — this is a product/business decision that gates Phase 4.1 implementation.

---

## 14. Unresolved Product Decisions

These require product input before the relevant phase can be implemented:

1. **Managed provider billing model** (blocks Phase 4.1): free tier? usage-based? subscription? This determines whether managed onboarding can ship or only BYOK.

2. **Invite-only vs public registration** (blocks Phase 0.4 scope): MVP with invite codes, or public signup from day one?

3. **Proactive notification defaults** (blocks Phase 3.2): what is the default proactive level for new users — off, low, or normal? Aggressive default may cause uninstalls; conservative default may hide the feature.

4. **Low-confidence extraction UX** (blocks Phase 2.2): when PDF extraction confidence is low, auto-create calendar events with disclaimer, or require explicit user confirmation per entry?

---

## 15. Deliberately Out of Scope

- Embedding Node.js runtime in Android APK
- Reimplementing consciousness/memory/brain in Kotlin
- On-device LLM inference
- New Telegram features
- PWA/web app as alternative surface
- Android-local LLM fallback for offline chat
- REST BFF layer in front of WebSocket protocol
- iOS client (future work, same hosted core)
