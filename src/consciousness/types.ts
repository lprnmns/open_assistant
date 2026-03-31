/**
 * src/consciousness/types.ts — Consciousness Loop shared type definitions
 *
 * Architecture overview
 * ─────────────────────
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │                   Consciousness Loop                     │
 *   │                                                          │
 *   │  ① Watchdog ($0)          ② Loop Engine (LLM call)      │
 *   │  ─────────────────        ──────────────────────────     │
 *   │  reads WorldSnapshot  →   only when WatchdogResult       │
 *   │  checks background        .wake === true                 │
 *   │  deltas, no LLM           builds context → LiteLLM       │
 *   │                           proxy → TickDecision           │
 *   └──────────────────────────────────────────────────────────┘
 *
 * CRITICAL: inbound user messages do NOT flow through this loop.
 * The normal gateway reply path handles them.  The Consciousness Loop
 * is a background-only process; it wakes only on background-state deltas.
 *
 * `new_message` is intentionally absent from WakeReason.
 */

// ── Compile-time exhaustiveness helpers ──────────────────────────────────────

/**
 * Forces a compile error if `T` is not exactly `never`.
 * Used at the bottom of switch/if-else chains to prove exhaustiveness.
 *
 * Usage:
 *   function handle(r: WakeReason): string {
 *     switch (r) { ... default: return assertNever(r); }
 *   }
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${String(value)}`);
}

/**
 * Type-level exhaustiveness probe.
 * A `Record<Union, true>` object literal must list every member of the union.
 * If a new value is added to the union, the object literal becomes a
 * compile error — the missing key must be added explicitly.
 *
 * Usage:
 *   const _: ExhaustiveRecord<WakeReason> = { TRIGGER_FIRED: true, ... };
 */
export type ExhaustiveRecord<T extends string> = Record<T, true>;

// ── Wake reasons ──────────────────────────────────────────────────────────────

/**
 * Why the Watchdog decided to wake the Loop Engine.
 *
 * Each reason maps to a $0 heuristic check:
 *   TRIGGER_FIRED        — a user-configured background trigger fired
 *   SILENCE_THRESHOLD    — no user interaction for >= silenceThresholdMs
 *   PENDING_NOTE         — a note was queued for LLM reflection
 *   CRON_DUE             — a scheduled cron expression is now due
 *   EXTERNAL_WORLD_DELTA — external state changed (calendar event, email, etc.)
 *
 * `new_message` is NOT a wake reason.  Inbound user messages are handled
 * by the gateway reply path; opening a second LLM call here would double
 * costs and produce incoherent responses.
 */
export type WakeReason =
  | "TRIGGER_FIRED"
  | "SILENCE_THRESHOLD"
  | "PENDING_NOTE"
  | "CRON_DUE"
  | "EXTERNAL_WORLD_DELTA";

// ── Tick actions ──────────────────────────────────────────────────────────────

/**
 * What the Loop Engine decides to do after consulting the LLM.
 *
 *   SEND_MESSAGE  — post a proactive message to the owner's active channel
 *   TAKE_NOTE     — append a note/memory entry without sending anything
 *   STAY_SILENT   — do nothing this tick (LLM decided there is nothing worth doing)
 *   ENTER_SLEEP   — transition into the Sleep Phase (nightly consolidation)
 */
export type TickAction = "SEND_MESSAGE" | "TAKE_NOTE" | "STAY_SILENT" | "ENTER_SLEEP";

// ── Consciousness phase (state machine) ───────────────────────────────────────

/**
 * The state machine that governs the loop lifecycle.
 *
 *   IDLE      ─► WATCHING  (loop started / tick timer fired)
 *   WATCHING  ─► IDLE      (Watchdog: wake=false → reschedule, $0)
 *   WATCHING  ─► THINKING  (Watchdog: wake=true  → LLM call begins)
 *   THINKING  ─► IDLE      (TickDecision received → action applied)
 *   THINKING  ─► SLEEPING  (TickDecision: ENTER_SLEEP)
 *   SLEEPING  ─► IDLE      (sleep window ends)
 *   any       ─► PAUSED    (operator pause / shutdown signal)
 *   PAUSED    ─► IDLE      (resume)
 */
export type ConsciousnessPhase =
  | "IDLE"
  | "WATCHING"
  | "THINKING"
  | "SLEEPING"
  | "PAUSED";

// ── World snapshot ────────────────────────────────────────────────────────────

/**
 * A point-in-time view of background state, built cheaply from Redis/DB
 * before involving the LLM.  This is what the Watchdog reads.
 *
 * Intentionally excludes the current inbound user message — that lives in
 * the gateway reply path, not here.
 */
export type WorldSnapshot = {
  /** Unix ms when this snapshot was taken. */
  capturedAt: number;

  /**
   * Unix ms of the last user interaction (message sent or received).
   * Used by the Watchdog to compute silence duration.
   * undefined = no interaction on record (brand-new agent).
   */
  lastUserInteractionAt: number | undefined;

  /** Notes queued for LLM reflection (PENDING_NOTE wakeup path). */
  pendingNoteCount: number;

  /**
   * Background triggers that have fired since the last tick.
   * Each string is an opaque trigger ID defined by the user.
   */
  firedTriggerIds: string[];

  /**
   * Cron expressions that are due this tick.
   * Format: standard 5-field cron strings.
   */
  dueCronExpressions: string[];

  /**
   * External world events detected since the last tick
   * (e.g. new calendar invite, incoming email, push notification).
   * Each string is a structured event descriptor: "<source>:<kind>:<id>".
   */
  externalWorldEvents: string[];

  /**
   * Human-readable label for the owner's currently active channel.
   * Used when SEND_MESSAGE is decided.
   * undefined = no channel is active; SEND_MESSAGE should fall back to default.
   */
  activeChannelId: string | undefined;

  /**
   * Buffered events from external surfaces (owner channel + third-party contacts).
   * Injected into the LLM prompt via buildEventPromptLines().
   * Owner-channel events shown to the LLM are drained after SEND_MESSAGE / TAKE_NOTE.
   * undefined = no event buffer attached (pre-6.2 behaviour; treated as empty buffer).
   */
  eventBuffer?: EventBuffer;

  /**
   * Unix ms of the last completed tick (THINKING → decision applied).
   * undefined = loop has never ticked.
   */
  lastTickAt: number | undefined;

  /**
   * The silence threshold that was active when this snapshot was taken.
   * The Watchdog uses this field (not the raw config) so that backoff
   * expansions (§ silence backoff) persist across snapshots.
   */
  effectiveSilenceThresholdMs: number;
};

// ── Watchdog result ───────────────────────────────────────────────────────────

/**
 * Output of the Watchdog ($0 heuristic check).
 *
 * Discriminated union — the `wake` field gates the LLM call:
 *   wake: false → reschedule tick, no LLM call ($0)
 *   wake: true  → proceed to Loop Engine, LLM call begins
 *
 * When wake is true, `reason` and `context` describe what changed.
 * The Loop Engine uses `context` to build the LLM prompt without re-reading
 * the snapshot.
 */
export type WatchdogResult =
  | { wake: false }
  | {
      wake: true;
      reason: WakeReason;
      /**
       * Free-form context string forwarded to the Loop Engine.
       * The Loop Engine appends this to the LLM system prompt so the model
       * knows why it was woken without reconstructing the reason from scratch.
       */
      context: string;
      /**
       * Updated silence threshold after backoff expansion (if reason is
       * SILENCE_THRESHOLD).  The Loop Engine must persist this back to
       * WorldSnapshot.effectiveSilenceThresholdMs to prevent re-trigger
       * storms: threshold grows by 50% each time silence fires, capped at
       * ConsciousnessConfig.maxSilenceThresholdMs.
       */
      nextSilenceThresholdMs?: number;
    };

// ── Tick decision ─────────────────────────────────────────────────────────────

/**
 * Shared optional fields present on every TickDecision variant.
 */
type TickDecisionBase = {
  /** Reasoning trace from the LLM (debug / audit only, never sent to user). */
  reasoning?: string;
  /**
   * How long the Loop Engine should wait before the next tick.
   * May be ignored; the engine clamps to [minTickIntervalMs, maxTickIntervalMs].
   */
  suggestedNextTickDelayMs?: number;
};

/**
 * What the Loop Engine decided to do, after the LLM call.
 * One TickDecision per tick.
 *
 * Proper discriminated union: each action variant enforces its required
 * payload.  { action: "SEND_MESSAGE" } without messageContent is a
 * compile-time error.
 */
export type TickDecision =
  | ({ action: "SEND_MESSAGE"; messageContent: string } & TickDecisionBase)
  | ({ action: "TAKE_NOTE"; noteContent: string } & TickDecisionBase)
  | ({ action: "STAY_SILENT" } & TickDecisionBase)
  | ({ action: "ENTER_SLEEP" } & TickDecisionBase);

// ── Consciousness configuration ───────────────────────────────────────────────

/**
 * Static configuration for the Consciousness Loop, resolved at boot time.
 * All timing values are in milliseconds.
 */
export type ConsciousnessConfig = {
  /**
   * Minimum wait between consecutive ticks.
   * Prevents runaway loop when every tick wakes.
   * Default: 30_000 (30 s)
   */
  minTickIntervalMs: number;

  /**
   * Maximum wait between consecutive ticks.
   * Default: 300_000 (5 min)
   */
  maxTickIntervalMs: number;

  /**
   * How often the Watchdog runs its $0 delta checks between ticks.
   * Must be < minTickIntervalMs.
   * Default: 15_000 (15 s)
   */
  watchdogIntervalMs: number;

  /**
   * Initial silence threshold: if the owner has not interacted for this
   * long, the Watchdog fires SILENCE_THRESHOLD.
   * Default: 1_800_000 (30 min)
   */
  baseSilenceThresholdMs: number;

  /**
   * Upper bound for the backoff-expanded silence threshold.
   * Default: 14_400_000 (4 h)
   */
  maxSilenceThresholdMs: number;

  /**
   * Hour (UTC, 0–23) when the agent enters Sleep Phase.
   * Default: 0 (midnight)
   */
  sleepStartHourUtc: number;

  /**
   * Hour (UTC, 0–23) when the agent wakes from Sleep Phase.
   * Default: 7 (07:00 UTC)
   */
  sleepEndHourUtc: number;

  /**
   * How long to wait after consolidation completes before allowing a soft
   * early wake from the Sleep Phase (milliseconds).
   *
   * The soft early wake fires when:
   *   capturedAt >= consolidationCompletedAt + postConsolidationDelayMs
   *
   * Set to 0 to wake immediately after consolidation.
   * Default: 300_000 (5 min)
   */
  postConsolidationDelayMs: number;

  /**
   * LLM source tag used for all Loop Engine calls.
   * Always "consciousness" — exposed here so the cost store records it.
   */
  readonly llmSource: "consciousness";
};

/**
 * Default ConsciousnessConfig values.
 * Callers merge their overrides on top of this.
 */
export const DEFAULT_CONSCIOUSNESS_CONFIG: ConsciousnessConfig = {
  minTickIntervalMs: 30_000,
  maxTickIntervalMs: 300_000,
  watchdogIntervalMs: 15_000,
  baseSilenceThresholdMs: 1_800_000,
  maxSilenceThresholdMs: 14_400_000,
  sleepStartHourUtc: 0,
  sleepEndHourUtc: 7,
  postConsolidationDelayMs: 300_000,
  llmSource: "consciousness",
};

// ── Consciousness runtime state ───────────────────────────────────────────────

import {
  INITIAL_CONSOLIDATION_TRIGGER_STATE,
  type ConsolidationTriggerState,
} from "./sleep/trigger.js";
import type { EventBuffer } from "./events/buffer.js";

export type { ConsolidationTriggerState };

/**
 * Mutable runtime state of the Consciousness Loop.
 * Owned by the Loop Engine; not persisted to disk (reconstructed at boot).
 */
export type ConsciousnessState = {
  phase: ConsciousnessPhase;

  /** The configuration in effect for this run. */
  config: ConsciousnessConfig;

  /**
   * The most recent WorldSnapshot built by the Watchdog.
   * undefined before the first Watchdog run.
   */
  lastSnapshot: WorldSnapshot | undefined;

  /**
   * The most recent Watchdog result.
   * undefined before the first Watchdog run.
   */
  lastWatchdogResult: WatchdogResult | undefined;

  /**
   * The most recent TickDecision produced by the Loop Engine.
   * undefined before the first tick that woke the LLM.
   */
  lastDecision: TickDecision | undefined;

  /**
   * Monotonically increasing count of completed ticks (Watchdog ran,
   * regardless of wake outcome).
   */
  tickCount: number;

  /**
   * Monotonically increasing count of ticks where the LLM was called
   * (wake === true).  Used for cost estimates and debug logging.
   */
  llmCallCount: number;

  /**
   * The adaptive tick interval currently in effect (ms).
   * Grows toward maxTickIntervalMs when idle; resets to minTickIntervalMs on wake.
   * Seeded to config.minTickIntervalMs at boot.
   */
  currentDelayMs: number;

  /**
   * Unix ms when the loop was last started (or restarted after PAUSED).
   */
  startedAt: number;

  /**
   * Sleep-phase consolidation tracking.
   *
   * sleepEnteredAt          set by loop.ts on ENTER_SLEEP decision
   * consolidationCompletedAt set by the scheduler when the consolidation
   *                          pipeline finishes (Sub-Task 5.3)
   *
   * evaluateConsolidationTrigger() reads this field to decide whether the
   * consolidation pass should run — zero cost, pure function.
   */
  consolidation: ConsolidationTriggerState;
};

/**
 * Build a fresh ConsciousnessState with sane zero values.
 */
export function makeInitialConsciousnessState(
  config: ConsciousnessConfig = DEFAULT_CONSCIOUSNESS_CONFIG,
): ConsciousnessState {
  return {
    phase: "IDLE",
    config,
    lastSnapshot: undefined,
    lastWatchdogResult: undefined,
    lastDecision: undefined,
    tickCount: 0,
    llmCallCount: 0,
    currentDelayMs: config.minTickIntervalMs,
    startedAt: Date.now(),
    consolidation: INITIAL_CONSOLIDATION_TRIGGER_STATE,
  };
}
