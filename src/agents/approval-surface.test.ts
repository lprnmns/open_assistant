import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TOOL_APPROVAL_TIMEOUT_MS,
  requestToolApproval,
  type ApprovalSurface,
} from "./approval-surface.js";

describe("requestToolApproval", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true when the approval surface approves", async () => {
    const surface: ApprovalSurface = {
      onApprovalRequest: vi.fn().mockResolvedValue(true),
    };

    await expect(
      requestToolApproval({
        surface,
        toolName: "calendar_add",
        args: [{ startsAt: "2026-04-03T14:00:00Z" }],
        confirmPrompt: "Approve?",
      }),
    ).resolves.toBe(true);
  });

  it("returns false when the approval surface rejects", async () => {
    const surface: ApprovalSurface = {
      onApprovalRequest: vi.fn().mockResolvedValue(false),
    };

    await expect(
      requestToolApproval({
        surface,
        toolName: "calendar_add",
        args: [],
        confirmPrompt: "Approve?",
      }),
    ).resolves.toBe(false);
  });

  it("times out to false after the default timeout", async () => {
    vi.useFakeTimers();
    const surface: ApprovalSurface = {
      onApprovalRequest: () => new Promise<boolean>(() => {}),
    };

    const approvalPromise = requestToolApproval({
      surface,
      toolName: "calendar_add",
      args: [],
      confirmPrompt: "Approve?",
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_TOOL_APPROVAL_TIMEOUT_MS);
    await expect(approvalPromise).resolves.toBe(false);
  });

  it("treats callback errors as rejection", async () => {
    const surface: ApprovalSurface = {
      onApprovalRequest: vi.fn().mockRejectedValue(new Error("boom")),
    };

    await expect(
      requestToolApproval({
        surface,
        toolName: "calendar_add",
        args: [],
        confirmPrompt: "Approve?",
      }),
    ).resolves.toBe(false);
  });
});
