import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandleCommandsParams } from "./commands-types.js";

const { createOpenClawCodingToolsMock, buildAgentSystemPromptMock } = vi.hoisted(() => ({
  createOpenClawCodingToolsMock: vi.fn(() => []),
  buildAgentSystemPromptMock: vi.fn(() => "system prompt"),
}));

vi.mock("../../agents/bootstrap-files.js", () => ({
  resolveBootstrapContextForRun: vi.fn(async () => ({
    bootstrapFiles: [],
    contextFiles: [],
  })),
}));

vi.mock("../../agents/pi-tools.js", () => ({
  createOpenClawCodingTools: createOpenClawCodingToolsMock,
}));

vi.mock("../../agents/sandbox.js", () => ({
  resolveSandboxRuntimeStatus: vi.fn(() => ({ sandboxed: false, mode: "off" })),
}));

vi.mock("../../agents/skills.js", () => ({
  buildWorkspaceSkillSnapshot: vi.fn(() => ({ prompt: "", skills: [], resolvedSkills: [] })),
}));

vi.mock("../../agents/skills/refresh.js", () => ({
  getSkillsSnapshotVersion: vi.fn(() => "test-snapshot"),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveSessionAgentIds: vi.fn(() => ({ sessionAgentId: "main" })),
}));

vi.mock("../../agents/model-selection.js", () => ({
  resolveDefaultModelForAgent: vi.fn(() => ({ provider: "openai", model: "gpt-5" })),
}));

vi.mock("../../agents/system-prompt-params.js", () => ({
  buildSystemPromptParams: vi.fn(() => ({
    runtimeInfo: { host: "unknown", os: "unknown", arch: "unknown", node: process.version },
    userTimezone: "UTC",
    userTime: "12:00 PM",
    userTimeFormat: "12h",
  })),
}));

vi.mock("../../agents/system-prompt.js", () => ({
  buildAgentSystemPrompt: buildAgentSystemPromptMock,
}));

vi.mock("../../agents/tool-summaries.js", () => ({
  buildToolSummaryMap: vi.fn(() => ({})),
}));

vi.mock("../../infra/skills-remote.js", () => ({
  getRemoteSkillEligibility: vi.fn(() => false),
}));

vi.mock("../../tts/tts.js", () => ({
  buildTtsSystemPromptHint: vi.fn(() => undefined),
}));

function makeParams(): HandleCommandsParams {
  return {
    ctx: {
      SessionKey: "agent:main:default",
    },
    cfg: {},
    command: {
      surface: "telegram",
      channel: "telegram",
      ownerList: [],
      senderIsOwner: true,
      isAuthorizedSender: true,
      rawBodyNormalized: "/context",
      commandBodyNormalized: "/context",
    },
    directives: {},
    elevated: {
      enabled: true,
      allowed: true,
      failures: [],
    },
    agentId: "main",
    agentDir: "/tmp/agent",
    sessionEntry: {
      sessionId: "session-1",
      groupId: "group-1",
      groupChannel: "#general",
      space: "guild-1",
      spawnedBy: "agent:parent",
    },
    sessionKey: "agent:main:default",
    workspaceDir: "/tmp/workspace",
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolvedElevatedLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "openai",
    model: "gpt-5.4",
    contextTokens: 0,
    isGroup: false,
  } as unknown as HandleCommandsParams;
}

async function loadResolveCommandsSystemPromptBundle() {
  const module = await import("./commands-system-prompt.js");
  return module.resolveCommandsSystemPromptBundle;
}

describe("resolveCommandsSystemPromptBundle", () => {
  beforeEach(() => {
    vi.resetModules();
    createOpenClawCodingToolsMock.mockClear();
    createOpenClawCodingToolsMock.mockReturnValue([]);
    buildAgentSystemPromptMock.mockClear();
    buildAgentSystemPromptMock.mockReturnValue("system prompt");
  });

  it("opts command tool builds into gateway subagent binding", async () => {
    const resolveCommandsSystemPromptBundle = await loadResolveCommandsSystemPromptBundle();
    await resolveCommandsSystemPromptBundle(makeParams());

    expect(createOpenClawCodingToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowGatewaySubagentBinding: true,
        agentDir: "/tmp/agent",
        sessionKey: "agent:main:default",
        workspaceDir: "/tmp/workspace",
        messageProvider: "telegram",
      }),
    );
  });

  it("passes consciousness runtime scope through to the system prompt builder", async () => {
    const resolveCommandsSystemPromptBundle = await loadResolveCommandsSystemPromptBundle();
    await resolveCommandsSystemPromptBundle({
      ...makeParams(),
      opts: {
        consciousnessRuntimeScope: "account:user-a",
      } as HandleCommandsParams["opts"],
    });

    expect(buildAgentSystemPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        consciousnessRuntimeScope: "account:user-a",
      }),
    );
  });
});
