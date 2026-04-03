import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExecApprovalSurfaceAdapter,
  resetExecApprovalSurfaceAdapterForTest,
} from "./exec-approval-surface-adapter.js";

const requestExecApprovalDecisionMock = vi.fn();

describe("createExecApprovalSurfaceAdapter", () => {
  beforeEach(() => {
    requestExecApprovalDecisionMock.mockReset();
    resetExecApprovalSurfaceAdapterForTest();
  });

  it("requests gateway approval with turn-source context", async () => {
    requestExecApprovalDecisionMock.mockResolvedValueOnce("allow-once");
    const surface = createExecApprovalSurfaceAdapter({
      workdir: "/tmp/founder",
      agentId: "main",
      sessionKey: "agent:main:telegram:dm:123",
      turnSourceChannel: "telegram",
      turnSourceTo: "123",
      turnSourceAccountId: "acct-1",
      turnSourceThreadId: "thread-9",
      requestDecision: requestExecApprovalDecisionMock,
    });

    const approved = await surface.onApprovalRequest({
      toolName: "email.send",
      args: [{ to: "ali@example.com", subject: "Hello", body: "Founder update" }],
      confirmPrompt: "approval required",
    });

    expect(approved).toBe(true);
    expect(requestExecApprovalDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        sessionKey: "agent:main:telegram:dm:123",
        cwd: "/tmp/founder",
        host: "gateway",
        security: "full",
        ask: "always",
        turnSourceChannel: "telegram",
        turnSourceTo: "123",
        turnSourceAccountId: "acct-1",
        turnSourceThreadId: "thread-9",
      }),
    );
    expect(requestExecApprovalDecisionMock.mock.calls[0]?.[0]?.command).toContain("tool email.send");
  });

  it("caches allow-always decisions per session scope", async () => {
    requestExecApprovalDecisionMock.mockResolvedValueOnce("allow-always");
    const surface = createExecApprovalSurfaceAdapter({
      agentId: "main",
      sessionKey: "agent:main:main",
      requestDecision: requestExecApprovalDecisionMock,
    });

    await expect(
      surface.onApprovalRequest({
        toolName: "calendar.cancel",
        args: [{ eventId: "evt-1" }],
        confirmPrompt: "needs approval",
      }),
    ).resolves.toBe(true);
    await expect(
      surface.onApprovalRequest({
        toolName: "calendar.cancel",
        args: [{ eventId: "evt-2" }],
        confirmPrompt: "needs approval",
      }),
    ).resolves.toBe(true);

    expect(requestExecApprovalDecisionMock).toHaveBeenCalledTimes(1);
  });

  it("treats deny and timeout as rejected approval", async () => {
    requestExecApprovalDecisionMock.mockResolvedValueOnce("deny");
    const surface = createExecApprovalSurfaceAdapter({
      requestDecision: requestExecApprovalDecisionMock,
    });

    await expect(
      surface.onApprovalRequest({
        toolName: "email.send",
        args: [],
        confirmPrompt: "needs approval",
      }),
    ).resolves.toBe(false);

    requestExecApprovalDecisionMock.mockResolvedValueOnce(null);
    await expect(
      surface.onApprovalRequest({
        toolName: "email.send",
        args: [],
        confirmPrompt: "needs approval",
      }),
    ).resolves.toBe(false);
  });
});
