import { filterToolsByPolicy } from "./pi-tools.policy.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { isKnownCoreToolId } from "./tool-catalog.js";
import {
  buildPluginToolGroups,
  expandPolicyWithPluginGroups,
  normalizeToolName,
  stripPluginOnlyAllowlist,
  type ToolPolicyLike,
} from "./tool-policy.js";

// ── Metadata types ────────────────────────────────────────────────────────────

/**
 * Rate-limit configuration for a single tool.
 * All fields are optional; a missing field means "no limit on that window".
 */
export type RateLimitConfig = {
  /** Maximum invocations allowed per minute. */
  perMinute?: number;
  /** Maximum invocations allowed per hour. */
  perHour?: number;
  /** Maximum invocations allowed per day. */
  perDay?: number;
};

/**
 * Per-tool metadata contributed by a single pipeline step.
 * Keys are tool names (normalized before storage — see normalizeToolName).
 */
export type ToolPolicyMeta = {
  /**
   * Reversibility score per tool (0.0 = fully destructive, 1.0 = fully reversible).
   * Example: { exec: 0.0, read: 1.0 }
   * When multiple steps supply a score for the same tool, the last step wins.
   */
  reversibilityScore?: Record<string, number>;

  /**
   * Tool names that must not execute without explicit human approval.
   * Accumulated as a union across all steps — adding a tool here can never be undone
   * by a later step.
   */
  requiresHuman?: string[];

  /**
   * Per-tool rate-limit configuration.
   * When multiple steps supply limits for the same tool, the last step wins.
   */
  rateLimits?: Record<string, RateLimitConfig>;
};

/**
 * Resolved (merged) metadata from all pipeline steps.
 * Produced by applyToolPolicyPipeline() alongside the filtered tool list.
 */
export type ResolvedToolPolicyMeta = {
  /**
   * Merged reversibility scores (later step overrides earlier per tool).
   * Absent entry means no score was declared — callers should treat unknown
   * tools as needing explicit review.
   */
  readonly reversibilityScores: Readonly<Record<string, number>>;

  /**
   * Union of all requiresHuman entries across all steps.
   * Use .has(normalizeToolName(toolName)) to check a specific tool.
   */
  readonly requiresHuman: ReadonlySet<string>;

  /**
   * Merged rate limits (later step overrides earlier per tool).
   */
  readonly rateLimits: Readonly<Record<string, RateLimitConfig>>;
};

// ── Pipeline types ────────────────────────────────────────────────────────────

export type ToolPolicyPipelineStep = {
  /** Allow/deny filter to apply at this step. undefined = step is a no-op for filtering. */
  policy: ToolPolicyLike | undefined;
  /** Human-readable label used in warning messages. */
  label: string;
  /** When true, strips plugin-only allowlists to prevent accidentally hiding core tools. */
  stripPluginOnlyAllowlist?: boolean;
  /**
   * Per-tool metadata contributed by this step.
   * Accumulated independently of policy filtering — a metadata-only step
   * (policy: undefined, meta: {...}) is valid and its meta is always applied.
   */
  meta?: ToolPolicyMeta;
};

export type ToolPolicyPipelineResult = {
  /** Tools that passed all policy filter steps. */
  tools: AnyAgentTool[];
  /** Merged metadata from all steps in the pipeline. */
  meta: ResolvedToolPolicyMeta;
};

const ACT_FIRST_AUTO_PATTERNS = [
  /^read$/,
  /^grep$/,
  /^glob$/,
  /^find$/,
  /^ls$/,
  /^status$/,
  /^search$/,
  /^show$/,
  /^view$/,
] as const;

const ACT_FIRST_BLOCK_PATTERNS = [
  /email/,
  /mail/,
  /message/,
  /send/,
  /tweet/,
  /post/,
  /publish/,
  /^exec$/,
  /^process$/,
  /delete/,
  /remove/,
  /drop/,
] as const;

const ACT_FIRST_CONFIRM_PATTERNS = [/write/, /edit/, /patch/, /update/, /create/] as const;

function resolveDefaultActFirstScore(toolName: string): number | undefined {
  const key = normalizeToolName(toolName);
  if (!key) return undefined;
  if (/^calendar(?:[_.-](add|create|update))?$/.test(key)) {
    return 0.8;
  }
  if (/^calendar(?:[_.-](cancel|delete|remove))$/.test(key)) {
    return 0.5;
  }
  if (ACT_FIRST_BLOCK_PATTERNS.some((pattern) => pattern.test(key))) {
    return 0.2;
  }
  if (ACT_FIRST_AUTO_PATTERNS.some((pattern) => pattern.test(key))) {
    return 1.0;
  }
  if (ACT_FIRST_CONFIRM_PATTERNS.some((pattern) => pattern.test(key))) {
    return 0.5;
  }
  return undefined;
}

export function buildDefaultActFirstToolPolicyMeta(
  tools: ReadonlyArray<Pick<AnyAgentTool, "name">>,
): ToolPolicyMeta | undefined {
  const reversibilityScore: Record<string, number> = {};
  for (const tool of tools) {
    const key = normalizeToolName(tool.name);
    const score = resolveDefaultActFirstScore(tool.name);
    if (!key || score === undefined) continue;
    reversibilityScore[key] = score;
  }
  return Object.keys(reversibilityScore).length > 0 ? { reversibilityScore } : undefined;
}

// ── Default step builder ──────────────────────────────────────────────────────

export function buildDefaultToolPolicyPipelineSteps(params: {
  profilePolicy?: ToolPolicyLike;
  profile?: string;
  providerProfilePolicy?: ToolPolicyLike;
  providerProfile?: string;
  globalPolicy?: ToolPolicyLike;
  globalProviderPolicy?: ToolPolicyLike;
  agentPolicy?: ToolPolicyLike;
  agentProviderPolicy?: ToolPolicyLike;
  groupPolicy?: ToolPolicyLike;
  agentId?: string;
}): ToolPolicyPipelineStep[] {
  const agentId = params.agentId?.trim();
  const profile = params.profile?.trim();
  const providerProfile = params.providerProfile?.trim();
  return [
    {
      policy: params.profilePolicy,
      label: profile ? `tools.profile (${profile})` : "tools.profile",
      stripPluginOnlyAllowlist: true,
    },
    {
      policy: params.providerProfilePolicy,
      label: providerProfile
        ? `tools.byProvider.profile (${providerProfile})`
        : "tools.byProvider.profile",
      stripPluginOnlyAllowlist: true,
    },
    { policy: params.globalPolicy, label: "tools.allow", stripPluginOnlyAllowlist: true },
    {
      policy: params.globalProviderPolicy,
      label: "tools.byProvider.allow",
      stripPluginOnlyAllowlist: true,
    },
    {
      policy: params.agentPolicy,
      label: agentId ? `agents.${agentId}.tools.allow` : "agent tools.allow",
      stripPluginOnlyAllowlist: true,
    },
    {
      policy: params.agentProviderPolicy,
      label: agentId ? `agents.${agentId}.tools.byProvider.allow` : "agent tools.byProvider.allow",
      stripPluginOnlyAllowlist: true,
    },
    { policy: params.groupPolicy, label: "group tools.allow", stripPluginOnlyAllowlist: true },
  ];
}

// ── Pipeline engine ───────────────────────────────────────────────────────────

/**
 * Apply a sequence of tool-policy filter steps and accumulate step metadata.
 *
 * Each step may contribute:
 *   - A policy (allow/deny filter) — when present, removes tools from the working set
 *   - Metadata (reversibilityScore, requiresHuman, rateLimits) — always accumulated,
 *     even when policy is undefined
 *
 * Metadata merge rules:
 *   - reversibilityScores: last step wins per tool name
 *   - requiresHuman:       cumulative union (entries can only be added, never removed)
 *   - rateLimits:          last step wins per tool name
 *
 * @returns ToolPolicyPipelineResult with filtered tools and merged metadata
 */
export function applyToolPolicyPipeline(params: {
  tools: AnyAgentTool[];
  toolMeta: (tool: AnyAgentTool) => { pluginId: string } | undefined;
  warn: (message: string) => void;
  steps: ToolPolicyPipelineStep[];
}): ToolPolicyPipelineResult {
  const coreToolNames = new Set(
    params.tools
      .filter((tool) => !params.toolMeta(tool))
      .map((tool) => normalizeToolName(tool.name))
      .filter(Boolean),
  );

  const pluginGroups = buildPluginToolGroups({
    tools: params.tools,
    toolMeta: params.toolMeta,
  });

  // Mutable accumulators for metadata
  const reversibilityScores: Record<string, number> = {};
  const requiresHuman = new Set<string>();
  const rateLimits: Record<string, RateLimitConfig> = {};

  let filtered = params.tools;

  for (const step of params.steps) {
    // ── Accumulate metadata (always, even when policy is absent) ────────────
    if (step.meta) {
      if (step.meta.reversibilityScore) {
        for (const [name, score] of Object.entries(step.meta.reversibilityScore)) {
          const key = normalizeToolName(name);
          if (key) reversibilityScores[key] = score;
        }
      }
      if (step.meta.requiresHuman) {
        for (const name of step.meta.requiresHuman) {
          const key = normalizeToolName(name);
          if (key) requiresHuman.add(key);
        }
      }
      if (step.meta.rateLimits) {
        for (const [name, limit] of Object.entries(step.meta.rateLimits)) {
          const key = normalizeToolName(name);
          if (key) rateLimits[key] = limit;
        }
      }
    }

    // ── Apply policy filter (only when policy is present) ───────────────────
    if (!step.policy) {
      continue;
    }

    let policy: ToolPolicyLike | undefined = step.policy;
    if (step.stripPluginOnlyAllowlist) {
      const resolved = stripPluginOnlyAllowlist(policy, pluginGroups, coreToolNames);
      if (resolved.unknownAllowlist.length > 0) {
        const entries = resolved.unknownAllowlist.join(", ");
        const gatedCoreEntries = resolved.unknownAllowlist.filter((entry) =>
          isKnownCoreToolId(entry),
        );
        const otherEntries = resolved.unknownAllowlist.filter((entry) => !isKnownCoreToolId(entry));
        const suffix = describeUnknownAllowlistSuffix({
          strippedAllowlist: resolved.strippedAllowlist,
          hasGatedCoreEntries: gatedCoreEntries.length > 0,
          hasOtherEntries: otherEntries.length > 0,
        });
        params.warn(
          `tools: ${step.label} allowlist contains unknown entries (${entries}). ${suffix}`,
        );
      }
      policy = resolved.policy;
    }

    const expanded = expandPolicyWithPluginGroups(policy, pluginGroups);
    filtered = expanded ? filterToolsByPolicy(filtered, expanded) : filtered;
  }

  return {
    tools: filtered,
    meta: { reversibilityScores, requiresHuman, rateLimits },
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function describeUnknownAllowlistSuffix(params: {
  strippedAllowlist: boolean;
  hasGatedCoreEntries: boolean;
  hasOtherEntries: boolean;
}): string {
  const preface = params.strippedAllowlist
    ? "Ignoring allowlist so core tools remain available."
    : "";
  const detail =
    params.hasGatedCoreEntries && params.hasOtherEntries
      ? "Some entries are shipped core tools but unavailable in the current runtime/provider/model/config; other entries won't match any tool unless the plugin is enabled."
      : params.hasGatedCoreEntries
        ? "These entries are shipped core tools but unavailable in the current runtime/provider/model/config."
        : "These entries won't match any tool unless the plugin is enabled.";
  return preface ? `${preface} ${detail}` : detail;
}
