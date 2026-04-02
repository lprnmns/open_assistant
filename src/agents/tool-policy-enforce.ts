/**
 * Tool Policy Enforcement Engine
 *
 * Shared enforcement logic for agent-path tool invocation and gateway HTTP tool
 * invocation. The classic allow/block behavior remains the default. Act-first
 * mode is opt-in and expands allowed decisions into auto/confirm/blocked.
 */

import {
  requestToolApproval,
  type ApprovalSurface,
} from "./approval-surface.js";
import { normalizeToolName } from "./tool-policy.js";
import type { ResolvedToolPolicyMeta } from "./tool-policy-pipeline.js";

export type RateLimitWindow = "minute" | "hour" | "day";

export type RateLimitCallCounts = {
  getCount: (toolName: string, window: RateLimitWindow) => number;
};

export type RateLimitStore = RateLimitCallCounts & {
  record: (toolName: string) => void;
};

export type ToolEnforcementDecision =
  | { mode: "auto"; allowed: true }
  | { mode: "confirm"; allowed: true; confirmPrompt: string; score: number }
  | {
      mode: "blocked";
      allowed: false;
      reason:
        | "requires-human"
        | "rate-limit-exceeded"
        | "missing-reversibility-score"
        | "low-reversibility-score";
      message: string;
    };

export type WrapToolWithEnforcementOptions = {
  store?: RateLimitStore;
  approvalSurface?: ApprovalSurface;
  approvalTimeoutMs?: number;
  actFirstEnabled?: boolean;
};

function isRateLimitStore(value: unknown): value is RateLimitStore {
  return (
    typeof value === "object" &&
    value !== null &&
    "getCount" in value &&
    typeof value.getCount === "function" &&
    "record" in value &&
    typeof value.record === "function"
  );
}

function resolveWrapOptions(
  storeOrOptions?: RateLimitStore | WrapToolWithEnforcementOptions,
  maybeOptions?: WrapToolWithEnforcementOptions,
): WrapToolWithEnforcementOptions {
  if (isRateLimitStore(storeOrOptions)) {
    return { ...maybeOptions, store: storeOrOptions };
  }
  return storeOrOptions ?? {};
}

function buildConfirmPrompt(toolName: string, score: number): string {
  return `Tool '${toolName}' needs approval before execution (reversibilityScore=${score.toFixed(2)})`;
}

export function evaluateToolEnforcement(params: {
  toolName: string;
  meta: ResolvedToolPolicyMeta;
  humanApproved?: boolean;
  callCounts?: RateLimitCallCounts;
  actFirstEnabled?: boolean;
}): ToolEnforcementDecision {
  const key = normalizeToolName(params.toolName);

  if (key && params.meta.requiresHuman.has(key) && params.humanApproved !== true) {
    return {
      mode: "blocked",
      allowed: false,
      reason: "requires-human",
      message: `Tool '${params.toolName}' requires explicit human approval before execution`,
    };
  }

  const limits = key ? params.meta.rateLimits[key] : undefined;
  if (limits && params.callCounts) {
    const windows: Array<{ window: RateLimitWindow; limit: number | undefined }> = [
      { window: "minute", limit: limits.perMinute },
      { window: "hour", limit: limits.perHour },
      { window: "day", limit: limits.perDay },
    ];
    for (const { window, limit } of windows) {
      if (limit === undefined) continue;
      const count = params.callCounts.getCount(key, window);
      if (count >= limit) {
        return {
          mode: "blocked",
          allowed: false,
          reason: "rate-limit-exceeded",
          message: `Tool '${params.toolName}' rate limit exceeded: ${count}/${limit} calls per ${window}`,
        };
      }
    }
  }

  if (!params.actFirstEnabled) {
    return { mode: "auto", allowed: true };
  }

  // Explicit human approval preserves the existing HTTP escape hatch for tools
  // that were already marked requiresHuman by policy.
  if (key && params.meta.requiresHuman.has(key) && params.humanApproved === true) {
    return { mode: "auto", allowed: true };
  }

  const rawScore = key ? params.meta.reversibilityScores[key] : undefined;
  if (typeof rawScore !== "number" || !Number.isFinite(rawScore)) {
    return {
      mode: "blocked",
      allowed: false,
      reason: "missing-reversibility-score",
      message: `Tool '${params.toolName}' has no reversibility score; refusing execution in act-first mode`,
    };
  }
  const score = rawScore;
  if (score < 0.3) {
    return {
      mode: "blocked",
      allowed: false,
      reason: "low-reversibility-score",
      message: `Tool '${params.toolName}' is too risky to auto-run (reversibilityScore=${score.toFixed(2)})`,
    };
  }
  if (score < 0.7) {
    if (params.humanApproved === true) {
      return { mode: "auto", allowed: true };
    }
    return {
      mode: "confirm",
      allowed: true,
      score,
      confirmPrompt: buildConfirmPrompt(params.toolName, score),
    };
  }

  return { mode: "auto", allowed: true };
}

export function wrapToolWithEnforcement<T extends { name: string }>(
  tool: T,
  meta: ResolvedToolPolicyMeta,
  storeOrOptions?: RateLimitStore | WrapToolWithEnforcementOptions,
  maybeOptions?: WrapToolWithEnforcementOptions,
): T {
  // oxlint-disable-next-line typescript/no-explicit-any
  const asAny = tool as any;
  if (typeof asAny.execute !== "function") return tool;

  const options = resolveWrapOptions(storeOrOptions, maybeOptions);
  const original: (...args: unknown[]) => unknown = asAny.execute;
  return {
    ...tool,
    execute: (...args: unknown[]): unknown => {
      const decision = evaluateToolEnforcement({
        toolName: tool.name,
        meta,
        humanApproved: false,
        callCounts: options.store,
        actFirstEnabled: options.actFirstEnabled,
      });
      if (!decision.allowed) {
        throw new Error(decision.message);
      }
      if (decision.mode === "confirm") {
        if (!options.approvalSurface) {
          throw new Error(
            `Tool '${tool.name}' needs interactive approval, but no approval surface is available`,
          );
        }
        return (async () => {
          const approved = await requestToolApproval({
            surface: options.approvalSurface!,
            toolName: tool.name,
            args,
            confirmPrompt: decision.confirmPrompt,
            timeoutMs: options.approvalTimeoutMs,
          });
          if (!approved) {
            throw new Error(`Tool '${tool.name}' approval denied or timed out`);
          }
          options.store?.record(tool.name);
          return await original(...args);
        })();
      }
      options.store?.record(tool.name);
      return original(...args);
    },
  } as T;
}
