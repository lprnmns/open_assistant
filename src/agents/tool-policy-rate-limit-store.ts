/**
 * src/agents/tool-policy-rate-limit-store.ts — In-memory rate-limit store
 *
 * InMemoryRateLimitStore implements sliding-window counting using an array of
 * call timestamps per normalized tool name.  getCount() prunes stale entries
 * on each read, so memory is bounded by the number of calls within the widest
 * active window.
 *
 * Lifecycle:
 *   - For the agent path: create one store per session
 *     (createOpenClawCodingTools is called once per session init).
 *   - For the HTTP gateway path: create one store per sessionKey and keep it in
 *     a module-level Map so counts persist across requests in the same session.
 *
 * Production note: this implementation is process-local and not distributed.
 * For multi-process deployments, replace with a Redis-backed implementation of
 * the same RateLimitStore interface.
 */

import { normalizeToolName } from "./tool-policy.js";
import type { RateLimitStore, RateLimitWindow } from "./tool-policy-enforce.js";

// Window sizes in milliseconds
const WINDOW_MS: Record<RateLimitWindow, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly timestamps = new Map<string, number[]>();

  /**
   * Record one call for the given tool.
   * Must be called after enforcement passes and before (or around) execution.
   */
  record(toolName: string): void {
    const key = normalizeToolName(toolName);
    if (!key) return;
    const ts = this.timestamps.get(key) ?? [];
    ts.push(Date.now());
    this.timestamps.set(key, ts);
  }

  /**
   * Return the number of recorded calls for the tool within the given window.
   *
   * Pruning uses the widest window (day) so that timestamps required by narrower
   * windows (hour, minute) are never destroyed by an earlier getCount("minute")
   * call in the same enforcement pass.
   */
  getCount(toolName: string, window: RateLimitWindow): number {
    const key = normalizeToolName(toolName);
    if (!key) return 0;
    const now = Date.now();
    const ts = this.timestamps.get(key) ?? [];
    // Prune only entries older than the widest window to keep memory bounded
    // without silently discarding data still needed by wider checks.
    const pruned = ts.filter((t) => t >= now - WINDOW_MS.day);
    this.timestamps.set(key, pruned);
    const windowCutoff = now - WINDOW_MS[window];
    return pruned.filter((t) => t >= windowCutoff).length;
  }
}

// ── Session-keyed store registry (gateway / shared-process use) ───────────────

const sessionStores = new Map<string, InMemoryRateLimitStore>();

/**
 * Get (or lazily create) a per-session rate-limit store.
 * Used by the HTTP gateway, where the handler is stateless per-request but
 * rate-limit counts must survive across requests in the same session.
 */
export function getSessionRateLimitStore(sessionKey: string): InMemoryRateLimitStore {
  const existing = sessionStores.get(sessionKey);
  if (existing) return existing;
  const store = new InMemoryRateLimitStore();
  sessionStores.set(sessionKey, store);
  return store;
}
