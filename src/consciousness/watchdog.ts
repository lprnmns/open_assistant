/**
 * src/consciousness/watchdog.ts — Heuristic Watchdog ($0 delta-check engine)
 *
 * The Watchdog runs before every potential LLM call and answers one question:
 *   "Has anything in the background state changed enough to warrant waking
 *    the Loop Engine?"
 *
 * All checks are purely heuristic — no network calls, no LLM, no disk I/O
 * beyond what WorldSnapshot already holds.  Cost: $0.
 *
 * CRITICAL: inbound user messages are NOT a wake condition.  The normal
 * gateway reply path handles them.  `new_message` is absent from WakeReason.
 *
 * Silence backoff
 * ───────────────
 * Each time SILENCE_THRESHOLD fires, the effective threshold grows by 50%
 * (capped at ConsciousnessConfig.maxSilenceThresholdMs).  This prevents a
 * re-trigger storm when the owner is simply away for an extended period.
 * The new threshold is returned in WatchdogResult.nextSilenceThresholdMs so
 * the Loop Engine can persist it back to WorldSnapshot.
 */

import type {
  ConsciousnessConfig,
  WatchdogResult,
  WorldSnapshot,
} from "./types.js";

// ── Individual delta checks ($0 each) ────────────────────────────────────────

function checkTriggerFired(snap: WorldSnapshot): WatchdogResult | null {
  if (snap.firedTriggerIds.length === 0) return null;
  const ids = snap.firedTriggerIds.join(", ");
  return {
    wake: true,
    reason: "TRIGGER_FIRED",
    context: `Background trigger(s) fired since last tick: ${ids}`,
  };
}

function checkSilenceThreshold(
  snap: WorldSnapshot,
  config: ConsciousnessConfig,
): WatchdogResult | null {
  // No interaction on record → brand-new agent, don't fire silence
  if (snap.lastUserInteractionAt === undefined) return null;

  const silentForMs = snap.capturedAt - snap.lastUserInteractionAt;
  if (silentForMs <= snap.effectiveSilenceThresholdMs) return null;

  // Expand threshold by 50%, capped at maxSilenceThresholdMs
  const next = Math.min(
    Math.round(snap.effectiveSilenceThresholdMs * 1.5),
    config.maxSilenceThresholdMs,
  );

  const silentMinutes = Math.round(silentForMs / 60_000);
  return {
    wake: true,
    reason: "SILENCE_THRESHOLD",
    context: `Owner has been silent for ${silentMinutes} minutes (threshold: ${Math.round(snap.effectiveSilenceThresholdMs / 60_000)} min)`,
    nextSilenceThresholdMs: next,
  };
}

function checkPendingNote(snap: WorldSnapshot): WatchdogResult | null {
  if (snap.pendingNoteCount === 0) return null;
  return {
    wake: true,
    reason: "PENDING_NOTE",
    context: `${snap.pendingNoteCount} note(s) queued for reflection`,
  };
}

function checkCronDue(snap: WorldSnapshot): WatchdogResult | null {
  if (snap.dueCronExpressions.length === 0) return null;
  const exprs = snap.dueCronExpressions.join(", ");
  return {
    wake: true,
    reason: "CRON_DUE",
    context: `Cron expression(s) due this tick: ${exprs}`,
  };
}

function checkExternalWorldDelta(snap: WorldSnapshot): WatchdogResult | null {
  if (snap.externalWorldEvents.length === 0) return null;
  const count = snap.externalWorldEvents.length;
  const sample = snap.externalWorldEvents[0]!;
  const suffix = count > 1 ? ` (+${count - 1} more)` : "";
  return {
    wake: true,
    reason: "EXTERNAL_WORLD_DELTA",
    context: `${count} external world event(s) detected: ${sample}${suffix}`,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run all heuristic delta checks against a WorldSnapshot.
 *
 * Checks are evaluated in priority order:
 *   1. TRIGGER_FIRED        — explicit user-configured trigger
 *   2. PENDING_NOTE         — queued reflection work
 *   3. CRON_DUE             — scheduled expression fired
 *   4. EXTERNAL_WORLD_DELTA — external state changed
 *   5. SILENCE_THRESHOLD    — owner has been silent long enough
 *
 * Returns the first matching WatchdogResult (highest priority wins).
 * Returns { wake: false } when no delta is detected — the Loop Engine
 * must NOT make an LLM call in this case.
 *
 * @param snap    Point-in-time background state (built cheaply from Redis/DB)
 * @param config  Consciousness Loop configuration (for threshold limits)
 */
export function runWatchdog(
  snap: WorldSnapshot,
  config: ConsciousnessConfig,
): WatchdogResult {
  return (
    checkTriggerFired(snap) ??
    checkPendingNote(snap) ??
    checkCronDue(snap) ??
    checkExternalWorldDelta(snap) ??
    checkSilenceThreshold(snap, config) ??
    { wake: false }
  );
}
