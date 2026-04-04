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

import { createSubsystemLogger } from "../logging/subsystem.js";
import { createDispatchAuditEntry, type ConsciousnessAuditLog } from "./audit.js";
import type { ConsciousnessConfig, TickDecision, WorldSnapshot } from "./types.js";
import { DEFAULT_CONSCIOUSNESS_CONFIG } from "./types.js";

const consciousnessLog = createSubsystemLogger("consciousness");

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
  sendToChannel: (
    channelId: string,
    content: string,
    channelType?: WorldSnapshot["activeChannelType"],
  ) => Promise<void>;

  /**
   * Persist a note / memory entry.
   * Called ONLY when action === TAKE_NOTE.
   * If this throws, the error is captured in DispatchResult — the Loop must
   * remain running.
   */
  appendNote: (content: string) => Promise<void>;

  /**
   * Mutable proactive dispatch state that persists across ticks.
   */
  proactiveState?: {
    lastSentAt?: number;
  };

  /**
   * Optional persistence hook for successful proactive sends.
   * Called only after sendToChannel resolved and the in-memory proactiveState
   * was updated, so the durable store stays aligned with runtime state.
   */
  onProactiveSent?: (sentAt: number) => void;

  /**
   * Optional audit sink for proactive send attempts.
   */
  auditLog?: ConsciousnessAuditLog;
};

// ── Dispatch result ───────────────────────────────────────────────────────────

export type DispatchResult = {
  /** True when a side-effect was successfully executed. */
  dispatched: boolean;
  /** Machine-readable outcome for tests and runtime observability. */
  outcome:
    | "sent"
    | "rate_limited"
    | "send_error"
    | "no_active_channel"
    | "note_saved"
    | "note_error"
    | "stay_silent"
    | "enter_sleep";
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
  config: ConsciousnessConfig = DEFAULT_CONSCIOUSNESS_CONFIG,
): Promise<DispatchResult> {
  switch (decision.action) {
    case "SEND_MESSAGE": {
      if (!snap.activeChannelId) {
        // No active channel — drop silently, never broadcast to an unknown surface
        consciousnessLog.info("dispatch dropped", { reason: "no_active_channel" });
        return { dispatched: false, outcome: "no_active_channel" };
      }
      const now = Date.now();
      const lastSentAt = ctx.proactiveState?.lastSentAt;
      const minIntervalMs = Math.max(0, config.proactiveMessageMinIntervalMs);
      if (
        lastSentAt !== undefined &&
        minIntervalMs > 0 &&
        now - lastSentAt < minIntervalMs
      ) {
        ctx.auditLog?.append(
          createDispatchAuditEntry({
            timestamp: now,
            channelId: snap.activeChannelId,
            channelType: snap.activeChannelType,
            content: decision.messageContent,
            decision: "rate_limited",
          }),
        );
        consciousnessLog.info("dispatch rate_limited", {
          channelId: snap.activeChannelId,
          channelType: snap.activeChannelType ?? "(unknown)",
          minIntervalMs,
        });
        return { dispatched: false, outcome: "rate_limited" };
      }

      const content = capProactiveContent(
        decision.messageContent,
        config.proactiveMessageMaxContentChars,
      );
      try {
        await ctx.sendToChannel(snap.activeChannelId, content, snap.activeChannelType);
        if (ctx.proactiveState) {
          ctx.proactiveState.lastSentAt = now;
        }
        ctx.onProactiveSent?.(now);
        ctx.auditLog?.append(
          createDispatchAuditEntry({
            timestamp: now,
            channelId: snap.activeChannelId,
            channelType: snap.activeChannelType,
            content,
            decision: "sent",
          }),
        );
        return { dispatched: true, outcome: "sent" };
      } catch (err) {
        ctx.auditLog?.append(
          createDispatchAuditEntry({
            timestamp: now,
            channelId: snap.activeChannelId,
            channelType: snap.activeChannelType,
            content,
            decision: "send_error",
          }),
        );
        consciousnessLog.error("dispatch send_error", {
          channelId: snap.activeChannelId,
          channelType: snap.activeChannelType ?? "(unknown)",
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          dispatched: false,
          outcome: "send_error",
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }

    case "TAKE_NOTE": {
      try {
        await ctx.appendNote(decision.noteContent);
        return { dispatched: true, outcome: "note_saved" };
      } catch (err) {
        // Dispatch failure must not propagate — loop stays alive
        return {
          dispatched: false,
          outcome: "note_error",
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }

    case "STAY_SILENT": {
      consciousnessLog.info("stay_silent", {
        reasoning: decision.reasoning ? decision.reasoning.slice(0, 160) : undefined,
      });
      return { dispatched: false, outcome: "stay_silent" };
    }
    case "ENTER_SLEEP":
      consciousnessLog.info("enter_sleep");
      // No side-effect; phase transition is handled by the Loop Engine
      return { dispatched: false, outcome: "enter_sleep" };
  }
}

function capProactiveContent(content: string, maxChars: number): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    return "";
  }
  if (content.length <= maxChars) {
    return content;
  }
  if (maxChars <= 3) {
    return content.slice(0, maxChars);
  }
  return `${content.slice(0, maxChars - 3).trimEnd()}...`;
}
