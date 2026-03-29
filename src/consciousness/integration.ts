/**
 * src/consciousness/integration.ts — Tick Decision Dispatcher
 *
 * Translates a TickDecision into real side-effects:
 *
 *   SEND_MESSAGE → send to owner's active channel ONLY (snap.activeChannelId)
 *                  If activeChannelId is undefined, message is dropped silently —
 *                  NEVER broadcast to an arbitrary fallback surface.
 *   TAKE_NOTE    → append to note store.
 *                  Errors are caught and returned — the Loop never crashes.
 *   STAY_SILENT  → no-op
 *   ENTER_SLEEP  → no-op (phase transition already applied by Loop Engine)
 *
 * CRITICAL: This module has no path for inbound user messages.
 * It is called exclusively by ConsciousnessScheduler after a tick.
 * Inbound messages must be handled by the gateway reply path only.
 */

import type { TickDecision, WorldSnapshot } from "./types.js";

// ── Dispatch context (injected by caller) ─────────────────────────────────────

/**
 * Side-effect callbacks injected by the application layer.
 * Both are async so callers can bridge to any transport without adapter overhead.
 */
export type DispatchContext = {
  /**
   * Send a proactive message to a specific channel.
   * Called ONLY when action === SEND_MESSAGE AND snap.activeChannelId is defined.
   * Never called with a fallback channel — if activeChannelId is absent the
   * message is silently dropped to avoid unintended broadcast.
   */
  sendToChannel: (channelId: string, content: string) => Promise<void>;

  /**
   * Persist a note / memory entry.
   * Called ONLY when action === TAKE_NOTE.
   * If this throws, the error is captured in DispatchResult — the Loop must
   * remain running.
   */
  appendNote: (content: string) => Promise<void>;
};

// ── Dispatch result ───────────────────────────────────────────────────────────

export type DispatchResult = {
  /** True when a side-effect was successfully executed. */
  dispatched: boolean;
  /**
   * Set when dispatch failed (callback threw, no active channel, etc.).
   * Presence of `error` does NOT mean the Loop should stop — callers should
   * log and continue.
   */
  error?: Error;
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Dispatch a TickDecision as a side-effect.
 *
 * Contract:
 *   - Never throws.  All errors from ctx callbacks are caught.
 *   - SEND_MESSAGE only routes to snap.activeChannelId.
 *   - TAKE_NOTE errors are captured; the caller's loop must continue.
 *
 * @param decision  Output of the Loop Engine's LLM call.
 * @param snap      The WorldSnapshot that was current when the tick ran.
 * @param ctx       Application-provided side-effect callbacks.
 */
export async function dispatchDecision(
  decision: TickDecision,
  snap: WorldSnapshot,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  switch (decision.action) {
    case "SEND_MESSAGE": {
      if (!snap.activeChannelId) {
        // No active channel — drop silently, never broadcast to an unknown surface
        return { dispatched: false };
      }
      try {
        await ctx.sendToChannel(snap.activeChannelId, decision.messageContent);
        return { dispatched: true };
      } catch (err) {
        return {
          dispatched: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }

    case "TAKE_NOTE": {
      try {
        await ctx.appendNote(decision.noteContent);
        return { dispatched: true };
      } catch (err) {
        // Dispatch failure must not propagate — loop stays alive
        return {
          dispatched: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }

    case "STAY_SILENT":
    case "ENTER_SLEEP":
      // No side-effect; phase transition is handled by the Loop Engine
      return { dispatched: false };
  }
}
