import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { prepareExternalRuntimeTools } from "./external-tool-runtime.js";
import type { AnyAgentTool } from "./pi-tools.types.js";

function createTool(params: {
  name: string;
  execute?: ReturnType<
    typeof vi.fn<(toolCallId: string, params: unknown) => Promise<AgentToolResult<unknown>>>
  >;
}): AnyAgentTool {
  const execute =
    params.execute ??
    vi.fn(async () => ({
      content: [{ type: "text" as const, text: `${params.name}:ok` }],
      details: {},
    }));
  return {
    name: params.name,
    label: params.name,
    description: params.name,
    parameters: { type: "object", properties: {} },
    execute: execute as AnyAgentTool["execute"],
  };
}

describe("prepareExternalRuntimeTools", () => {
  it("auto-executes high-reversibility calendar.create tools", async () => {
    const execute = vi.fn().mockResolvedValue("created");
    const approvalSurface = { onApprovalRequest: vi.fn().mockResolvedValue(true) };
    const [tool] = prepareExternalRuntimeTools({
      tools: [createTool({ name: "calendar.create", execute })],
      actFirstEnabled: true,
      approvalSurface,
      sessionKey: "agent:main:main",
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    await (tool as any).execute("tool-1", { title: "Demo" });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(approvalSurface.onApprovalRequest).not.toHaveBeenCalled();
  });

  it("requests confirmation for calendar.cancel tools", async () => {
    const execute = vi.fn().mockResolvedValue("canceled");
    const approvalSurface = { onApprovalRequest: vi.fn().mockResolvedValue(true) };
    const [tool] = prepareExternalRuntimeTools({
      tools: [createTool({ name: "calendar.cancel", execute })],
      actFirstEnabled: true,
      approvalSurface,
      sessionKey: "agent:main:main",
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    await (tool as any).execute("tool-2", { eventId: "evt-1" });

    expect(approvalSurface.onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "calendar.cancel" }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("requires approval for low-reversibility email.send tools", async () => {
    const execute = vi.fn().mockResolvedValue("sent");
    const approvalSurface = { onApprovalRequest: vi.fn().mockResolvedValue(true) };
    const [tool] = prepareExternalRuntimeTools({
      tools: [createTool({ name: "email.send", execute })],
      actFirstEnabled: true,
      approvalSurface,
      sessionKey: "agent:main:main",
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    await (tool as any).execute("tool-3", { to: "ali@example.com" });

    expect(approvalSurface.onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "email.send" }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
