import type { ModelCompatConfig } from "../config/types.models.js";
import type { ToolLoopDetectionConfig } from "../config/types.tools.js";
import type { ApprovalSurface } from "./approval-surface.js";
import { wrapToolWithAbortSignal } from "./pi-tools.abort.js";
import { wrapToolWithBeforeToolCallHook } from "./pi-tools.before-tool-call.js";
import { normalizeToolParameters } from "./pi-tools.schema.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { wrapToolWithEnforcement } from "./tool-policy-enforce.js";
import {
  buildDefaultActFirstToolPolicyMeta,
  type ResolvedToolPolicyMeta,
} from "./tool-policy-pipeline.js";
import { getSessionRateLimitStore, InMemoryRateLimitStore } from "./tool-policy-rate-limit-store.js";
import { getDefaultUndoRegistry } from "./undo-registry.js";

type PrepareExternalRuntimeToolsOptions = {
  tools: AnyAgentTool[];
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  modelProvider?: string;
  modelId?: string;
  modelCompat?: ModelCompatConfig;
  abortSignal?: AbortSignal;
  actFirstEnabled?: boolean;
  approvalSurface?: ApprovalSurface;
  loopDetection?: ToolLoopDetectionConfig;
};

const EMPTY_META: ResolvedToolPolicyMeta = {
  reversibilityScores: {},
  requiresHuman: new Set<string>(),
  rateLimits: {},
};

function isActFirstEnabled(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") {
    return explicit;
  }
  return process.env.OPENCLAW_ACT_FIRST?.trim() === "1";
}

export function prepareExternalRuntimeTools(
  options: PrepareExternalRuntimeToolsOptions,
): AnyAgentTool[] {
  if (options.tools.length === 0) {
    return [];
  }

  const normalized = options.tools.map((tool) =>
    normalizeToolParameters(tool, {
      modelProvider: options.modelProvider,
      modelId: options.modelId,
      modelCompat: options.modelCompat,
    }),
  );
  const defaults = buildDefaultActFirstToolPolicyMeta(normalized);
  const meta: ResolvedToolPolicyMeta = defaults?.reversibilityScore
    ? {
        reversibilityScores: defaults.reversibilityScore,
        requiresHuman: new Set<string>(),
        rateLimits: {},
      }
    : EMPTY_META;
  const actFirstEnabled = isActFirstEnabled(options.actFirstEnabled);
  const rateLimitStore = options.sessionKey
    ? getSessionRateLimitStore(options.sessionKey)
    : new InMemoryRateLimitStore();
  const withEnforcement = normalized.map((tool) =>
    wrapToolWithEnforcement(tool, meta, {
      store: rateLimitStore,
      actFirstEnabled,
      approvalSurface: options.approvalSurface,
      undoRegistry: actFirstEnabled ? getDefaultUndoRegistry() : undefined,
      undoScopeKey: actFirstEnabled ? options.sessionKey ?? options.agentId ?? undefined : undefined,
    }),
  );
  const withHooks = withEnforcement.map((tool) =>
    wrapToolWithBeforeToolCallHook(tool, {
      agentId: options.agentId,
      sessionKey: options.sessionKey,
      sessionId: options.sessionId,
      runId: options.runId,
      loopDetection: options.loopDetection,
    }),
  );
  return options.abortSignal
    ? withHooks.map((tool) => wrapToolWithAbortSignal(tool, options.abortSignal))
    : withHooks;
}
