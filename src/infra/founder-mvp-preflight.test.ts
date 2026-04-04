import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type {
  ExecApprovalRouteCheckResult,
  ExecApprovalRouteRuntimeProbe,
} from "./exec-approval-route-check.js";
import { checkFounderMvpPreflight } from "./founder-mvp-preflight.js";

function makeApprovalResult(
  overrides?: Partial<ExecApprovalRouteCheckResult>,
): ExecApprovalRouteCheckResult {
  const runtime: ExecApprovalRouteRuntimeProbe = { checked: true, hasExecApprovalClients: true };
  return {
    ready: true,
    summary: "ready",
    agentId: "founder",
    sessionKey: "agent:founder",
    runtime,
    initiatingSurface: {
      kind: "enabled",
      channel: "telegram",
      channelLabel: "Telegram",
    },
    approverDmRouteConfigured: true,
    forwarding: {
      enabled: true,
      mode: "session",
      explicitTargetCount: 0,
      routeReady: true,
    },
    notes: [],
    ...overrides,
  };
}

function makeTool(name: string): AnyAgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async () => ({
      content: [],
      details: {},
    }),
  };
}

describe("checkFounderMvpPreflight", () => {
  const access = vi.fn(async () => {});
  const loadEmbeddedPiMcpConfig = vi.fn(() => ({
    mcpServers: {
      founderTools: { command: "node", args: ["./server.mjs"] },
    },
    diagnostics: [],
  }));
  const createBundleMcpToolRuntime = vi.fn(async () => ({
    tools: [makeTool("calendar.create"), makeTool("calendar.cancel"), makeTool("email.send")],
    dispose: vi.fn(async () => {}),
  }));
  const checkExecApprovalRoutes = vi.fn(async () => makeApprovalResult());

  afterEach(() => {
    vi.restoreAllMocks();
    access.mockClear();
    loadEmbeddedPiMcpConfig.mockClear();
    createBundleMcpToolRuntime.mockClear();
    checkExecApprovalRoutes.mockClear();
  });

  it("passes when node, consciousness paths, tools, and approvals are ready", async () => {
    const versionSpy = vi.spyOn(process, "version", "get").mockReturnValue("v22.16.1");

    const result = await checkFounderMvpPreflight(
      {
        cwd: "C:/workspace/openclaw",
        env: {
          CONSCIOUSNESS_ENABLED: "1",
          CONSCIOUSNESS_AUDIT_LOG_PATH: "data/consciousness-audit.jsonl",
        },
      },
      {
        access,
        loadEmbeddedPiMcpConfig,
        createBundleMcpToolRuntime,
        checkExecApprovalRoutes,
      },
    );

    expect(result.ready).toBe(true);
    expect(result.tools.missingTools).toEqual([]);
    expect(result.consciousness.ready).toBe(true);
    expect(result.node.ready).toBe(true);
    expect(result.summary).toContain("passed");
    versionSpy.mockRestore();
  });

  it("blocks when consciousness is disabled and audit path is missing", async () => {
    const versionSpy = vi.spyOn(process, "version", "get").mockReturnValue("v22.16.1");

    const result = await checkFounderMvpPreflight(
      {
        cwd: "C:/workspace/openclaw",
        env: {},
      },
      {
        access,
        loadEmbeddedPiMcpConfig,
        createBundleMcpToolRuntime,
        checkExecApprovalRoutes,
      },
    );

    expect(result.ready).toBe(false);
    expect(result.consciousness.enabled).toBe(false);
    expect(result.notes).toContain("CONSCIOUSNESS_ENABLED is not set to 1/true.");
    expect(result.notes.some((note) => note.includes("Audit log"))).toBe(true);
    versionSpy.mockRestore();
  });

  it("blocks when required tools are missing", async () => {
    const versionSpy = vi.spyOn(process, "version", "get").mockReturnValue("v22.16.1");
    createBundleMcpToolRuntime.mockResolvedValueOnce({
      tools: [makeTool("calendar.create")],
      dispose: vi.fn(async () => {}),
    });

    const result = await checkFounderMvpPreflight(
      {
        cwd: "C:/workspace/openclaw",
        env: {
          CONSCIOUSNESS_ENABLED: "1",
          CONSCIOUSNESS_AUDIT_LOG_PATH: "data/consciousness-audit.jsonl",
        },
      },
      {
        access,
        loadEmbeddedPiMcpConfig,
        createBundleMcpToolRuntime,
        checkExecApprovalRoutes,
      },
    );

    expect(result.ready).toBe(false);
    expect(result.tools.missingTools).toEqual(["calendar.cancel", "email.send"]);
    expect(result.notes).toContain("Missing founder tools: calendar.cancel, email.send");
    versionSpy.mockRestore();
  });

  it("blocks when the approval route is not ready", async () => {
    const versionSpy = vi.spyOn(process, "version", "get").mockReturnValue("v22.16.1");
    checkExecApprovalRoutes.mockResolvedValueOnce(
      makeApprovalResult({
        ready: false,
        summary: "blocked",
        runtime: {
          checked: true,
          hasExecApprovalClients: false,
        },
        forwarding: {
          enabled: true,
          mode: "session",
          explicitTargetCount: 0,
          routeReady: false,
        },
        notes: ["No connected operator approval client and no forwarding route is ready."],
      }),
    );

    const result = await checkFounderMvpPreflight(
      {
        cwd: "C:/workspace/openclaw",
        env: {
          CONSCIOUSNESS_ENABLED: "1",
          CONSCIOUSNESS_AUDIT_LOG_PATH: "data/consciousness-audit.jsonl",
        },
      },
      {
        access,
        loadEmbeddedPiMcpConfig,
        createBundleMcpToolRuntime,
        checkExecApprovalRoutes,
      },
    );

    expect(result.ready).toBe(false);
    expect(result.approvals.ready).toBe(false);
    expect(result.summary).toContain("approval route is not ready");
    versionSpy.mockRestore();
  });

  it("blocks on unsupported Node versions", async () => {
    const versionSpy = vi.spyOn(process, "version", "get").mockReturnValue("v20.20.0");

    const result = await checkFounderMvpPreflight(
      {
        cwd: "C:/workspace/openclaw",
        env: {
          CONSCIOUSNESS_ENABLED: "1",
          CONSCIOUSNESS_AUDIT_LOG_PATH: "data/consciousness-audit.jsonl",
        },
      },
      {
        access,
        loadEmbeddedPiMcpConfig,
        createBundleMcpToolRuntime,
        checkExecApprovalRoutes,
      },
    );

    expect(result.ready).toBe(false);
    expect(result.node.ready).toBe(false);
    expect(result.summary).toContain("Node 22.16.0+ is required");
    versionSpy.mockRestore();
  });

  it("reports MCP startup errors as tool discovery blockers", async () => {
    const versionSpy = vi.spyOn(process, "version", "get").mockReturnValue("v22.16.1");
    createBundleMcpToolRuntime.mockRejectedValueOnce(new Error("server launch failed"));

    const result = await checkFounderMvpPreflight(
      {
        cwd: "C:/workspace/openclaw",
        env: {
          CONSCIOUSNESS_ENABLED: "1",
          CONSCIOUSNESS_AUDIT_LOG_PATH: "data/consciousness-audit.jsonl",
        },
      },
      {
        access,
        loadEmbeddedPiMcpConfig,
        createBundleMcpToolRuntime,
        checkExecApprovalRoutes,
      },
    );

    expect(result.ready).toBe(false);
    expect(result.tools.error).toBe("server launch failed");
    expect(result.notes).toContain("Tool discovery: server launch failed");
    versionSpy.mockRestore();
  });
});
