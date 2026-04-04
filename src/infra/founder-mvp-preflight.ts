import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { loadEmbeddedPiMcpConfig } from "../agents/embedded-pi-mcp.js";
import { createBundleMcpToolRuntime } from "../agents/pi-bundle-mcp-tools.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  checkExecApprovalRoutes,
  type ExecApprovalRouteCheckResult,
  type ExecApprovalRouteRuntimeProbe,
} from "./exec-approval-route-check.js";

const FOUNDER_REQUIRED_TOOLS = ["calendar.create", "calendar.cancel", "email.send"] as const;
const MINIMUM_NODE_VERSION = "22.16.0";

type PathStatus = {
  configured: boolean;
  path?: string;
  resolvedPath?: string;
  parentDir?: string;
  ready: boolean;
  reason?: string;
};

type FounderMvpToolStatus = {
  configuredServers: string[];
  diagnostics: string[];
  availableTools: string[];
  requiredTools: string[];
  missingTools: string[];
  ready: boolean;
  error?: string;
};

export type FounderMvpPreflightResult = {
  ready: boolean;
  summary: string;
  node: {
    current: string;
    minimum: string;
    ready: boolean;
  };
  consciousness: {
    enabled: boolean;
    ready: boolean;
    state: PathStatus;
    db: PathStatus;
    audit: PathStatus;
  };
  tools: FounderMvpToolStatus;
  approvals: ExecApprovalRouteCheckResult;
  notes: string[];
};

type FounderMvpPreflightDeps = {
  access: typeof fs.access;
  loadEmbeddedPiMcpConfig: typeof loadEmbeddedPiMcpConfig;
  createBundleMcpToolRuntime: typeof createBundleMcpToolRuntime;
  checkExecApprovalRoutes: typeof checkExecApprovalRoutes;
};

type FounderMvpPreflightParams = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cfg?: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  turnSourceChannel?: string | null;
  turnSourceTo?: string | null;
  turnSourceAccountId?: string | null;
  turnSourceThreadId?: string | number | null;
  runtime?: ExecApprovalRouteRuntimeProbe;
  requiredTools?: readonly string[];
};

const defaultDeps: FounderMvpPreflightDeps = {
  access: fs.access.bind(fs),
  loadEmbeddedPiMcpConfig,
  createBundleMcpToolRuntime,
  checkExecApprovalRoutes,
};

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function parseVersion(value: string): [number, number, number] | null {
  const normalized = value.trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNodeVersionAtLeast(current: string, minimum: string): boolean {
  const currentParts = parseVersion(current);
  const minimumParts = parseVersion(minimum);
  if (!currentParts || !minimumParts) {
    return false;
  }
  for (let index = 0; index < currentParts.length; index += 1) {
    const delta = currentParts[index] - minimumParts[index];
    if (delta > 0) {
      return true;
    }
    if (delta < 0) {
      return false;
    }
  }
  return true;
}

function resolveRelativePath(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

async function checkWritablePath(params: {
  cwd: string;
  filePath?: string;
  requiredReason: string;
  access: typeof fs.access;
}): Promise<PathStatus> {
  if (!params.filePath?.trim()) {
    return {
      configured: false,
      ready: false,
      reason: params.requiredReason,
    };
  }

  const resolvedPath = resolveRelativePath(params.cwd, params.filePath);
  const parentDir = path.dirname(resolvedPath);

  try {
    await params.access(resolvedPath, fsConstants.F_OK);
    await params.access(resolvedPath, fsConstants.W_OK);
    return {
      configured: true,
      path: params.filePath,
      resolvedPath,
      parentDir,
      ready: true,
    };
  } catch {
    try {
      await params.access(parentDir, fsConstants.W_OK);
      return {
        configured: true,
        path: params.filePath,
        resolvedPath,
        parentDir,
        ready: true,
      };
    } catch {
      return {
        configured: true,
        path: params.filePath,
        resolvedPath,
        parentDir,
        ready: false,
        reason: `Parent directory is not writable or does not exist: ${parentDir}`,
      };
    }
  }
}

async function resolveToolStatus(
  params: FounderMvpPreflightParams & {
    cwd: string;
    requiredTools: readonly string[];
  },
  deps: FounderMvpPreflightDeps,
): Promise<FounderMvpToolStatus> {
  const loaded = deps.loadEmbeddedPiMcpConfig({
    workspaceDir: params.cwd,
    cfg: params.cfg,
  });
  const configuredServers = Object.keys(loaded.mcpServers).sort();
  const diagnostics = loaded.diagnostics.map(
    (diagnostic) => `${diagnostic.pluginId}: ${diagnostic.message}`,
  );

  if (configuredServers.length === 0) {
    return {
      configuredServers,
      diagnostics,
      availableTools: [],
      requiredTools: [...params.requiredTools],
      missingTools: [...params.requiredTools],
      ready: false,
      error: "No MCP servers are configured for the embedded founder runtime.",
    };
  }

  try {
    const runtime = await deps.createBundleMcpToolRuntime({
      workspaceDir: params.cwd,
      cfg: params.cfg,
      reservedToolNames: [],
    });
    try {
      const availableTools = runtime.tools.map((tool) => tool.name).sort();
      const availableSet = new Set(availableTools);
      const missingTools = params.requiredTools.filter((toolName) => !availableSet.has(toolName));
      return {
        configuredServers,
        diagnostics,
        availableTools,
        requiredTools: [...params.requiredTools],
        missingTools,
        ready: missingTools.length === 0,
      };
    } finally {
      await runtime.dispose();
    }
  } catch (error) {
    return {
      configuredServers,
      diagnostics,
      availableTools: [],
      requiredTools: [...params.requiredTools],
      missingTools: [...params.requiredTools],
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildSummary(params: {
  nodeReady: boolean;
  consciousnessReady: boolean;
  tools: FounderMvpToolStatus;
  approvalsReady: boolean;
}): string {
  const blockers: string[] = [];
  if (!params.nodeReady) {
    blockers.push(`Node ${MINIMUM_NODE_VERSION}+ is required`);
  }
  if (!params.consciousnessReady) {
    blockers.push("consciousness storage paths are not ready");
  }
  if (!params.tools.ready) {
    blockers.push(
      params.tools.error ?? `required tools missing: ${params.tools.missingTools.join(", ")}`,
    );
  }
  if (!params.approvalsReady) {
    blockers.push("approval route is not ready");
  }
  return blockers.length === 0
    ? "Founder MVP preflight passed."
    : `Founder MVP preflight blocked: ${blockers.join("; ")}.`;
}

export async function checkFounderMvpPreflight(
  params: FounderMvpPreflightParams = {},
  deps: FounderMvpPreflightDeps = defaultDeps,
): Promise<FounderMvpPreflightResult> {
  const cwd = params.cwd ?? process.cwd();
  const env = params.env ?? process.env;
  const stateFilePath =
    env.CONSCIOUSNESS_STATE_PATH === ""
      ? undefined
      : env.CONSCIOUSNESS_STATE_PATH?.trim() || "data/consciousness-state.json";
  const dbFilePath = env.CONSCIOUSNESS_DB_PATH?.trim() || "data/consciousness.db";
  const auditLogPath = env.CONSCIOUSNESS_AUDIT_LOG_PATH?.trim();
  const consciousnessEnabled = isTruthy(env.CONSCIOUSNESS_ENABLED);

  const [state, db, audit, tools, approvals] = await Promise.all([
    checkWritablePath({
      cwd,
      filePath: stateFilePath,
      requiredReason: "CONSCIOUSNESS_STATE_PATH is disabled or missing.",
      access: deps.access,
    }),
    checkWritablePath({
      cwd,
      filePath: dbFilePath,
      requiredReason: "CONSCIOUSNESS_DB_PATH is missing.",
      access: deps.access,
    }),
    checkWritablePath({
      cwd,
      filePath: auditLogPath,
      requiredReason: "CONSCIOUSNESS_AUDIT_LOG_PATH is missing.",
      access: deps.access,
    }),
    resolveToolStatus(
      {
        ...params,
        cwd,
        requiredTools: params.requiredTools ?? FOUNDER_REQUIRED_TOOLS,
      },
      deps,
    ),
    deps.checkExecApprovalRoutes({
      cfg: params.cfg,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      turnSourceChannel: params.turnSourceChannel,
      turnSourceTo: params.turnSourceTo,
      turnSourceAccountId: params.turnSourceAccountId,
      turnSourceThreadId: params.turnSourceThreadId,
      runtime: params.runtime,
    }),
  ]);

  const nodeCurrent = process.version;
  const nodeReady = isNodeVersionAtLeast(nodeCurrent, MINIMUM_NODE_VERSION);
  const consciousnessReady = consciousnessEnabled && state.ready && db.ready && audit.ready;
  const summary = buildSummary({
    nodeReady,
    consciousnessReady,
    tools,
    approvalsReady: approvals.ready,
  });
  const notes: string[] = [];

  if (!consciousnessEnabled) {
    notes.push("CONSCIOUSNESS_ENABLED is not set to 1/true.");
  }
  if (!state.ready && state.reason) {
    notes.push(`State store: ${state.reason}`);
  }
  if (!db.ready && db.reason) {
    notes.push(`Brain DB: ${db.reason}`);
  }
  if (!audit.ready && audit.reason) {
    notes.push(`Audit log: ${audit.reason}`);
  }
  if (!tools.ready) {
    if (tools.error) {
      notes.push(`Tool discovery: ${tools.error}`);
    } else if (tools.missingTools.length > 0) {
      notes.push(`Missing founder tools: ${tools.missingTools.join(", ")}`);
    }
  }
  notes.push(...tools.diagnostics);
  notes.push(...approvals.notes);

  return {
    ready: nodeReady && consciousnessReady && tools.ready && approvals.ready,
    summary,
    node: {
      current: nodeCurrent,
      minimum: `v${MINIMUM_NODE_VERSION}`,
      ready: nodeReady,
    },
    consciousness: {
      enabled: consciousnessEnabled,
      ready: consciousnessReady,
      state,
      db,
      audit,
    },
    tools,
    approvals,
    notes,
  };
}
