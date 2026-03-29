/**
 * src/consciousness/loop.ts — Consciousness Loop Engine
 *
 * The Loop Engine orchestrates the background tick cycle:
 *
 *   ① IDLE → WATCHING: Watchdog runs ($0 heuristic checks)
 *   ② WATCHING → IDLE:  wake:false → reschedule, no LLM call
 *   ③ WATCHING → THINKING: wake:true → build context, call LLM
 *   ④ THINKING → IDLE:  decision applied, next tick scheduled
 *   ④ THINKING → SLEEPING: decision is ENTER_SLEEP
 *
 * Adaptive tick interval
 * ──────────────────────
 * The interval between ticks adapts based on recency of wake events:
 *   - If the Watchdog woke (wake:true): next interval = minTickIntervalMs (urgent)
 *   - If the Watchdog slept (wake:false): interval grows toward maxTickIntervalMs
 *
 * Multi-delta handling (QA 2.2 residual note)
 * ────────────────────────────────────────────
 * The Watchdog returns the highest-priority delta only.  After the Loop Engine
 * applies a TickDecision, it immediately re-runs the Watchdog on a fresh
 * snapshot.  If further deltas remain (e.g. a pending note AND a cron) they
 * are handled in subsequent ticks with minTickIntervalMs spacing — not in one
 * batched call.  This prevents prompt stuffing and preserves per-delta cost
 * attribution.
 *
 * Inbound user messages
 * ─────────────────────
 * The Loop Engine has no path for inbound user messages.  It receives a
 * WorldSnapshot from the caller; that snapshot intentionally contains no
 * "current message" field.  All user message handling stays in the normal
 * gateway reply path.
 */

import { proxyCall } from "../llm/proxy-client.js";
import type { ProxyMessage } from "../llm/types.js";
import {
  type ConsciousnessConfig,
  type ConsciousnessState,
  type TickDecision,
  type WatchdogResult,
  type WorldSnapshot,
  DEFAULT_CONSCIOUSNESS_CONFIG,
  makeInitialConsciousnessState,
} from "./types.js";
import { runWatchdog } from "./watchdog.js";

// ── Prompt builder ────────────────────────────────────────────────────────────

/**
 * Build the LLM messages for a Consciousness tick.
 * The system prompt tells the model its role; the user turn carries the
 * Watchdog context (why it woke) and the current world state summary.
 */
function buildTickMessages(
  snap: WorldSnapshot,
  wakeResult: WatchdogResult & { wake: true },
): ProxyMessage[] {
  const system: ProxyMessage = {
    role: "system",
    content: [
      "You are a Consciousness Loop agent running in the background.",
      "Your job is to decide what (if anything) to do proactively on behalf of the owner.",
      "You must respond with a JSON object containing exactly one of these action values:",
      '  { "action": "SEND_MESSAGE", "messageContent": "<text>" }',
      '  { "action": "TAKE_NOTE",    "noteContent":    "<text>" }',
      '  { "action": "STAY_SILENT" }',
      '  { "action": "ENTER_SLEEP" }',
      "Only use SEND_MESSAGE when you have something genuinely useful to say.",
      "Prefer STAY_SILENT when uncertain.",
      "Respond with raw JSON only — no markdown, no explanation.",
    ].join("\n"),
  };

  const contextLines: string[] = [
    `Wake reason: ${wakeResult.reason}`,
    `Context: ${wakeResult.context}`,
    ``,
    `Current state:`,
    `  Pending notes: ${snap.pendingNoteCount}`,
    `  Active channel: ${snap.activeChannelId ?? "(none)"}`,
    `  Last tick: ${snap.lastTickAt ? new Date(snap.lastTickAt).toISOString() : "never"}`,
  ];

  if (snap.firedTriggerIds.length > 0) {
    contextLines.push(`  Fired triggers: ${snap.firedTriggerIds.join(", ")}`);
  }
  if (snap.externalWorldEvents.length > 0) {
    contextLines.push(`  External events: ${snap.externalWorldEvents.join(", ")}`);
  }

  const user: ProxyMessage = {
    role: "user",
    content: contextLines.join("\n"),
  };

  return [system, user];
}

// ── LLM response parser ───────────────────────────────────────────────────────

/**
 * Parse the LLM's JSON response into a TickDecision.
 * Falls back to STAY_SILENT on any parse error so the loop never crashes.
 */
function parseTickDecision(raw: string): TickDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return { action: "STAY_SILENT", reasoning: `JSON parse error: ${raw.slice(0, 100)}` };
  }

  if (!parsed || typeof parsed !== "object") {
    return { action: "STAY_SILENT", reasoning: "LLM response was not an object" };
  }

  const obj = parsed as Record<string, unknown>;
  const action = obj["action"];

  // Extract optional base fields shared by all TickDecision variants
  function parseBase(o: Record<string, unknown>) {
    const base: { reasoning?: string; suggestedNextTickDelayMs?: number } = {};
    if (typeof o["reasoning"] === "string") base.reasoning = o["reasoning"];
    if (typeof o["suggestedNextTickDelayMs"] === "number") {
      base.suggestedNextTickDelayMs = o["suggestedNextTickDelayMs"];
    }
    return base;
  }

  switch (action) {
    case "SEND_MESSAGE": {
      const content = typeof obj["messageContent"] === "string" ? obj["messageContent"].trim() : "";
      if (!content) return { action: "STAY_SILENT", reasoning: "SEND_MESSAGE had empty messageContent" };
      return { action: "SEND_MESSAGE", messageContent: content, ...parseBase(obj) };
    }
    case "TAKE_NOTE": {
      const content = typeof obj["noteContent"] === "string" ? obj["noteContent"].trim() : "";
      if (!content) return { action: "STAY_SILENT", reasoning: "TAKE_NOTE had empty noteContent" };
      return { action: "TAKE_NOTE", noteContent: content, ...parseBase(obj) };
    }
    case "STAY_SILENT":
      return { action: "STAY_SILENT", ...parseBase(obj) };
    case "ENTER_SLEEP":
      return { action: "ENTER_SLEEP", ...parseBase(obj) };
    default:
      return { action: "STAY_SILENT", reasoning: `Unknown action: ${String(action)}` };
  }
}

// ── Adaptive interval ─────────────────────────────────────────────────────────

/**
 * Compute the next tick delay.
 *
 * - LLM woke (wake:true):  minTickIntervalMs (urgent — re-check soon)
 * - LLM slept (wake:false): grow toward maxTickIntervalMs using a step of
 *   25% of the remaining range, so the interval relaxes gracefully.
 * - Decision suggests a delay: honour it, clamped to [min, max].
 */
export function computeNextTickDelayMs(params: {
  woke: boolean;
  decision: TickDecision | undefined;
  currentDelayMs: number;
  config: ConsciousnessConfig;
}): number {
  const { woke, decision, currentDelayMs, config } = params;

  if (decision?.suggestedNextTickDelayMs !== undefined) {
    return Math.min(
      Math.max(decision.suggestedNextTickDelayMs, config.minTickIntervalMs),
      config.maxTickIntervalMs,
    );
  }

  if (woke) {
    return config.minTickIntervalMs;
  }

  // Relax: step 25% of remaining range toward max
  const remaining = config.maxTickIntervalMs - currentDelayMs;
  const step = Math.round(remaining * 0.25);
  return Math.min(currentDelayMs + Math.max(step, 1), config.maxTickIntervalMs);
}

// ── Single tick ───────────────────────────────────────────────────────────────

export type TickResult = {
  /** Updated state after this tick. */
  state: ConsciousnessState;
  /** Watchdog output for this tick. */
  watchdogResult: WatchdogResult;
  /** Decision produced by the LLM, if it was called. */
  decision: TickDecision | undefined;
  /** How long to wait before the next tick (ms). */
  nextDelayMs: number;
};

/**
 * Run one Consciousness tick.
 *
 * 1. Increment tickCount; transition phase to WATCHING.
 * 2. Run Watchdog ($0).
 * 3. If wake:false → no LLM call, update silence threshold from snapshot,
 *    compute relaxed next interval, return.
 * 4. If wake:true  → transition to THINKING, call LiteLLM proxy,
 *    parse TickDecision, persist nextSilenceThresholdMs if applicable,
 *    update llmCallCount.
 * 5. Transition back to IDLE (or SLEEPING if ENTER_SLEEP).
 *
 * The caller is responsible for actually dispatching SEND_MESSAGE / TAKE_NOTE
 * actions (integration layer, Sub-Task 2.4).
 *
 * @param snap    Fresh WorldSnapshot built by the caller before calling tick()
 * @param state   Current ConsciousnessState (treated as immutable; returns new state)
 */
export async function tick(snap: WorldSnapshot, state: ConsciousnessState): Promise<TickResult> {
  const config = state.config;

  // ── Step 1: begin tick ────────────────────────────────────────────────────
  const nextTickCount = state.tickCount + 1;
  const watchingState: ConsciousnessState = {
    ...state,
    phase: "WATCHING",
    tickCount: nextTickCount,
    lastSnapshot: snap,
  };

  // ── Step 2: Watchdog ($0) ─────────────────────────────────────────────────
  const watchdogResult = runWatchdog(snap, config);

  // ── Step 3: No delta → reschedule without LLM call ───────────────────────
  if (!watchdogResult.wake) {
    const currentDelay = computeNextTickDelayMs({
      woke: false,
      decision: undefined,
      currentDelayMs: state.currentDelayMs,
      config,
    });

    const idleState: ConsciousnessState = {
      ...watchingState,
      phase: "IDLE",
      lastWatchdogResult: watchdogResult,
      currentDelayMs: currentDelay,
    };

    return { state: idleState, watchdogResult, decision: undefined, nextDelayMs: currentDelay };
  }

  // ── Step 4: Delta found → call LLM ───────────────────────────────────────
  const thinkingState: ConsciousnessState = {
    ...watchingState,
    phase: "THINKING",
    lastWatchdogResult: watchdogResult,
  };

  let decision: TickDecision;
  try {
    const messages = buildTickMessages(snap, watchdogResult);
    const result = await proxyCall({ source: "consciousness", messages, maxTokens: 512 });
    decision = parseTickDecision(result.content);
  } catch (err) {
    // LLM call failed — stay silent, don't crash the loop
    decision = {
      action: "STAY_SILENT",
      reasoning: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Update silence threshold if this wake was SILENCE_THRESHOLD
  const updatedSnap: WorldSnapshot =
    watchdogResult.reason === "SILENCE_THRESHOLD" &&
    watchdogResult.nextSilenceThresholdMs !== undefined
      ? { ...snap, effectiveSilenceThresholdMs: watchdogResult.nextSilenceThresholdMs }
      : snap;

  // ── Step 5: Apply decision → transition phase ─────────────────────────────
  const nextPhase: ConsciousnessState["phase"] =
    decision.action === "ENTER_SLEEP" ? "SLEEPING" : "IDLE";

  const nextDelay = computeNextTickDelayMs({
    woke: true,
    decision,
    currentDelayMs: state.currentDelayMs,
    config,
  });

  const finalState: ConsciousnessState = {
    ...thinkingState,
    phase: nextPhase,
    lastSnapshot: updatedSnap,
    lastDecision: decision,
    llmCallCount: thinkingState.llmCallCount + 1,
    currentDelayMs: nextDelay,
  };

  return { state: finalState, watchdogResult, decision, nextDelayMs: nextDelay };
}

// ── Public factory ────────────────────────────────────────────────────────────

export { DEFAULT_CONSCIOUSNESS_CONFIG, makeInitialConsciousnessState };
