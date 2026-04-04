import type { OpenClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import type { ExecApprovalForwardingMode } from "../config/types.approvals.js";
import {
  buildAgentMainSessionKey,
  DEFAULT_AGENT_ID,
  normalizeAgentId,
} from "../routing/session-key.js";
import { createExecApprovalForwarder } from "./exec-approval-forwarder.js";
import {
  hasConfiguredExecApprovalDmRoute,
  resolveExecApprovalInitiatingSurfaceState,
  type ExecApprovalInitiatingSurfaceState,
} from "./exec-approval-surface.js";
import type { ExecApprovalRequest } from "./exec-approvals.js";

export type ExecApprovalRouteRuntimeProbe = {
  checked: boolean;
  hasExecApprovalClients?: boolean;
  error?: string;
};

export type ExecApprovalRouteCheckParams = {
  cfg?: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  turnSourceChannel?: string | null;
  turnSourceTo?: string | null;
  turnSourceAccountId?: string | null;
  turnSourceThreadId?: string | number | null;
  runtime?: ExecApprovalRouteRuntimeProbe;
};

export type ExecApprovalForwardingProbe = {
  enabled: boolean;
  mode: ExecApprovalForwardingMode;
  explicitTargetCount: number;
  routeReady: boolean;
};

export type ExecApprovalRouteCheckResult = {
  ready: boolean;
  summary: string;
  agentId: string;
  sessionKey: string;
  runtime: ExecApprovalRouteRuntimeProbe;
  initiatingSurface: ExecApprovalInitiatingSurfaceState;
  approverDmRouteConfigured: boolean;
  forwarding: ExecApprovalForwardingProbe;
  notes: string[];
};

function normalizeOptionalString(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeThreadId(value?: string | number | null): string | number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildSyntheticRequest(params: {
  agentId: string;
  sessionKey: string;
  turnSourceChannel?: string;
  turnSourceTo?: string;
  turnSourceAccountId?: string;
  turnSourceThreadId?: string | number;
}): ExecApprovalRequest {
  const now = Date.now();
  return {
    id: "approval-route-preflight",
    createdAtMs: now,
    expiresAtMs: now + 60_000,
    request: {
      command: "approval route preflight",
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      turnSourceChannel: params.turnSourceChannel,
      turnSourceTo: params.turnSourceTo,
      turnSourceAccountId: params.turnSourceAccountId,
      turnSourceThreadId: params.turnSourceThreadId,
    },
  };
}

async function probeForwardingRoute(params: {
  cfg: OpenClawConfig;
  request: ExecApprovalRequest;
}): Promise<boolean> {
  const forwarder = createExecApprovalForwarder({
    getConfig: () => params.cfg,
    deliver: async () => {},
  });
  try {
    return await forwarder.handleRequested(params.request);
  } finally {
    forwarder.stop();
  }
}

function buildSummary(params: {
  runtime: ExecApprovalRouteRuntimeProbe;
  forwardingRouteReady: boolean;
}): string {
  if (params.runtime.hasExecApprovalClients === true) {
    return "Connected operator approval client found.";
  }
  if (params.forwardingRouteReady) {
    return "Configured approval forwarding route is ready for this request.";
  }
  if (params.runtime.checked) {
    return "No connected operator approval client and no forwarding route is ready.";
  }
  return "No forwarding route is ready, and runtime approval-client status could not be verified.";
}

export async function checkExecApprovalRoutes(
  params: ExecApprovalRouteCheckParams = {},
): Promise<ExecApprovalRouteCheckResult> {
  const cfg = params.cfg ?? loadConfig();
  const agentId = normalizeAgentId(params.agentId ?? DEFAULT_AGENT_ID);
  const sessionKey =
    normalizeOptionalString(params.sessionKey) ??
    buildAgentMainSessionKey({
      agentId,
    });
  const turnSourceChannel = normalizeOptionalString(params.turnSourceChannel);
  const turnSourceTo = normalizeOptionalString(params.turnSourceTo);
  const turnSourceAccountId = normalizeOptionalString(params.turnSourceAccountId);
  const turnSourceThreadId = normalizeThreadId(params.turnSourceThreadId);
  const request = buildSyntheticRequest({
    agentId,
    sessionKey,
    turnSourceChannel,
    turnSourceTo,
    turnSourceAccountId,
    turnSourceThreadId,
  });
  const approvalsConfig = cfg.approvals?.exec;
  const forwardingMode = approvalsConfig?.mode ?? "session";
  const forwardingRouteReady = await probeForwardingRoute({ cfg, request });
  const runtime: ExecApprovalRouteRuntimeProbe = params.runtime ?? { checked: false };
  const initiatingSurface = resolveExecApprovalInitiatingSurfaceState({
    channel: turnSourceChannel,
    accountId: turnSourceAccountId,
    cfg,
  });
  const approverDmRouteConfigured = hasConfiguredExecApprovalDmRoute(cfg);
  const notes: string[] = [];

  if (!approvalsConfig?.enabled) {
    notes.push("approvals.exec.enabled is false.");
  }
  if ((forwardingMode === "session" || forwardingMode === "both") && !params.sessionKey?.trim()) {
    notes.push("Session forwarding was checked with the default main session key.");
  }
  if ((forwardingMode === "session" || forwardingMode === "both") && !turnSourceChannel) {
    notes.push("No originating channel was supplied for the session-route probe.");
  }
  if (initiatingSurface.kind !== "enabled" && !approverDmRouteConfigured) {
    notes.push("Originating surface is not approval-enabled and no approver DM route is configured.");
  }
  if (!runtime.checked && runtime.error) {
    notes.push(runtime.error);
  }

  return {
    ready: runtime.hasExecApprovalClients === true || forwardingRouteReady,
    summary: buildSummary({ runtime, forwardingRouteReady }),
    agentId,
    sessionKey,
    runtime,
    initiatingSurface,
    approverDmRouteConfigured,
    forwarding: {
      enabled: approvalsConfig?.enabled === true,
      mode: forwardingMode,
      explicitTargetCount: approvalsConfig?.targets?.length ?? 0,
      routeReady: forwardingRouteReady,
    },
    notes,
  };
}
