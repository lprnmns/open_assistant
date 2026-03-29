/**
 * src/agents/tool-policy-enforce.ts — Tool Policy Enforcement Engine
 *
 * Evaluates whether a tool call is permitted given the pipeline's
 * ResolvedToolPolicyMeta, and provides a wrapper for the agent tool path.
 *
 * Design invariants:
 *   - requiresHuman is fail-closed: missing or undefined humanApproved → BLOCK.
 *     The tool must be explicitly approved; the default is denial.
 *   - Rate-limit keys use normalizeToolName() — consistent with how the pipeline
 *     stores keys (case-insensitive, trimmed).
 *   - A single evaluateToolEnforcement() function is used by both the HTTP gateway
 *     and the agent execution path.  No duplicate logic, no divergent decisions.
 *   - In the agent path (LLM calling tools), humanApproved is always false.
 *     The LLM cannot self-approve tools that require human authorization.
 */

import { normalizeToolName } from "./tool-policy.js";
import type { ResolvedToolPolicyMeta } from "./tool-policy-pipeline.js";

// ── Rate-limit support types ──────────────────────────────────────────────────

export type RateLimitWindow = "minute" | "hour" | "day";

/**
 * Abstraction over a call-count store.
 * The caller provides this; the engine does not own state.
 * Implement with an in-memory map or a Redis-backed store as needed.
 */
export type RateLimitCallCounts = {
  /**
   * Return the number of calls made for the given (normalized) tool name
   * within the given time window.
   */
  getCount: (toolName: string, window: RateLimitWindow) => number;
};

/**
 * Extends RateLimitCallCounts with a write side: record one call for a tool.
 * record() must be called after enforcement passes so the count advances for
 * the next caller in the same window.
 */
export type RateLimitStore = RateLimitCallCounts & {
  record: (toolName: string) => void;
};

// ── Enforcement decision ──────────────────────────────────────────────────────

export type ToolEnforcementDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "requires-human" | "rate-limit-exceeded";
      message: string;
    };

// ── Core enforcement function (shared by all execution paths) ─────────────────

/**
 * Evaluate whether a tool call is permitted.
 *
 * Checks (in order):
 *   1. requiresHuman — fail-closed: blocks unless humanApproved === true
 *   2. rate-limit    — blocks when the call-count for any configured window
 *                      meets or exceeds the declared limit
 *
 * @param params.toolName      The tool being invoked (normalized internally).
 * @param params.meta          ResolvedToolPolicyMeta from applyToolPolicyPipeline().
 * @param params.humanApproved true only when a human explicitly approved this call.
 *                             Absent/undefined counts as false (fail-closed).
 * @param params.callCounts    Optional call-count store for rate-limit checks.
 *                             When undefined, rate-limit checks are skipped.
 */
export function evaluateToolEnforcement(params: {
  toolName: string;
  meta: ResolvedToolPolicyMeta;
  humanApproved?: boolean;
  callCounts?: RateLimitCallCounts;
}): ToolEnforcementDecision {
  const key = normalizeToolName(params.toolName);

  // ── 1. requiresHuman (fail-closed) ────────────────────────────────────────
  if (key && params.meta.requiresHuman.has(key) && params.humanApproved !== true) {
    return {
      allowed: false,
      reason: "requires-human",
      message: `Tool '${params.toolName}' requires explicit human approval before execution`,
    };
  }

  // ── 2. Rate-limit ─────────────────────────────────────────────────────────
  const limits = key ? params.meta.rateLimits[key] : undefined;
  if (limits && params.callCounts) {
    const windows: Array<{ window: RateLimitWindow; limit: number | undefined }> = [
      { window: "minute", limit: limits.perMinute },
      { window: "hour", limit: limits.perHour },
      { window: "day", limit: limits.perDay },
    ];
    for (const { window, limit } of windows) {
      if (limit !== undefined) {
        const count = params.callCounts.getCount(key, window);
        if (count >= limit) {
          return {
            allowed: false,
            reason: "rate-limit-exceeded",
            message: `Tool '${params.toolName}' rate limit exceeded: ${count}/${limit} calls per ${window}`,
          };
        }
      }
    }
  }

  return { allowed: true };
}

// ── Agent-path wrapper ────────────────────────────────────────────────────────

/**
 * Wrap a tool's execute function with policy enforcement.
 * Used in the agent execution path (pi-tools.ts) so that every tool invocation
 * is checked at call time, using the meta from the policy pipeline.
 *
 * humanApproved is hardcoded to false in this wrapper — the LLM cannot
 * self-approve calls to requiresHuman tools.  Human approval must come
 * from an explicit HTTP request with humanApproved:true in the body.
 *
 * If the tool has no execute function it is returned unchanged.
 *
 * @param tool       The tool to wrap (any object with .name and optional .execute).
 * @param meta       Pipeline metadata for enforcement lookups.
 * @param store Optional rate-limit store; undefined disables rate-limit checks.
 *             When provided, record() is called after enforcement passes so the
 *             count advances for subsequent callers in the same window.
 */
export function wrapToolWithEnforcement<T extends { name: string }>(
  tool: T,
  meta: ResolvedToolPolicyMeta,
  store?: RateLimitStore,
): T {
  // oxlint-disable-next-line typescript/no-explicit-any
  const asAny = tool as any;
  if (typeof asAny.execute !== "function") return tool;

  const original: (...args: unknown[]) => unknown = asAny.execute;
  return {
    ...tool,
    execute: (...args: unknown[]): unknown => {
      const decision = evaluateToolEnforcement({
        toolName: tool.name,
        meta,
        humanApproved: false, // agent path: LLM cannot self-approve requiresHuman tools
        callCounts: store,
      });
      if (!decision.allowed) {
        throw new Error(decision.message);
      }
      store?.record(tool.name);
      return original(...args);
    },
  } as T;
}
