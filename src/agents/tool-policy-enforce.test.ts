import { describe, expect, it, vi } from "vitest";
import type { ApprovalSurface } from "./approval-surface.js";
import {
  evaluateToolEnforcement,
  wrapToolWithEnforcement,
  type RateLimitCallCounts,
} from "./tool-policy-enforce.js";
import type { ResolvedToolPolicyMeta } from "./tool-policy-pipeline.js";
import { InMemoryUndoRegistry } from "./undo-registry.js";

function makeMeta(overrides: Partial<ResolvedToolPolicyMeta> = {}): ResolvedToolPolicyMeta {
  return {
    reversibilityScores: {},
    requiresHuman: new Set<string>(),
    rateLimits: {},
    ...overrides,
  };
}

function makeCountStore(counts: Record<string, number> = {}): RateLimitCallCounts {
  return {
    getCount: (toolName, window) => counts[`${toolName}:${window}`] ?? 0,
  };
}

describe("evaluateToolEnforcement — classic behavior", () => {
  it("blocks requiresHuman tools when humanApproved is absent", () => {
    const meta = makeMeta({ requiresHuman: new Set(["exec"]) });
    const result = evaluateToolEnforcement({ toolName: "exec", meta });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.mode).toBe("blocked");
      expect(result.reason).toBe("requires-human");
    }
  });

  it("allows requiresHuman tools when humanApproved is true", () => {
    const meta = makeMeta({ requiresHuman: new Set(["exec"]) });
    const result = evaluateToolEnforcement({ toolName: "exec", meta, humanApproved: true });
    expect(result).toEqual({ mode: "auto", allowed: true });
  });

  it("blocks when rate limit is reached", () => {
    const meta = makeMeta({ rateLimits: { exec: { perMinute: 2 } } });
    const counts = makeCountStore({ "exec:minute": 2 });
    const result = evaluateToolEnforcement({ toolName: "exec", meta, callCounts: counts });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("rate-limit-exceeded");
      expect(result.message).toContain("2/2");
    }
  });

  it("preserves allow behavior when act-first mode is disabled", () => {
    const meta = makeMeta();
    const result = evaluateToolEnforcement({ toolName: "write", meta, actFirstEnabled: false });
    expect(result).toEqual({ mode: "auto", allowed: true });
  });
});

describe("evaluateToolEnforcement — act-first mode", () => {
  it("auto-allows high-score tools", () => {
    const meta = makeMeta({ reversibilityScores: { read: 1.0 } });
    const result = evaluateToolEnforcement({ toolName: "read", meta, actFirstEnabled: true });
    expect(result).toEqual({ mode: "auto", allowed: true });
  });

  it("requests confirmation for mid-score tools", () => {
    const meta = makeMeta({ reversibilityScores: { write: 0.5 } });
    const result = evaluateToolEnforcement({ toolName: "write", meta, actFirstEnabled: true });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.mode).toBe("confirm");
      if (result.mode === "confirm") {
        expect(result.confirmPrompt).toContain("write");
        expect(result.score).toBe(0.5);
      }
    }
  });

  it("auto-allows confirmed mid-score tools when humanApproved is true", () => {
    const meta = makeMeta({ reversibilityScores: { write: 0.5 } });
    const result = evaluateToolEnforcement({
      toolName: "write",
      meta,
      actFirstEnabled: true,
      humanApproved: true,
    });
    expect(result).toEqual({ mode: "auto", allowed: true });
  });

  it("blocks low-score tools with approval-required reason", () => {
    const meta = makeMeta({ reversibilityScores: { email_send: 0.2 } });
    const result = evaluateToolEnforcement({
      toolName: "email_send",
      meta,
      actFirstEnabled: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("approval-required-low-reversibility");
    }
  });

  it("auto-allows low-score tools when humanApproved is true", () => {
    const meta = makeMeta({ reversibilityScores: { email_send: 0.2 } });
    const result = evaluateToolEnforcement({
      toolName: "email_send",
      meta,
      actFirstEnabled: true,
      humanApproved: true,
    });
    expect(result).toEqual({ mode: "auto", allowed: true });
  });

  it("keeps missing-reversibility-score fail-closed even with humanApproved", () => {
    const meta = makeMeta();
    const result = evaluateToolEnforcement({
      toolName: "unknown_tool",
      meta,
      actFirstEnabled: true,
      humanApproved: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("missing-reversibility-score");
    }
  });

  it("blocks tools with missing scores", () => {
    const meta = makeMeta();
    const result = evaluateToolEnforcement({
      toolName: "unknown_tool",
      meta,
      actFirstEnabled: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("missing-reversibility-score");
    }
  });

  it("requiresHuman still takes priority over scores", () => {
    const meta = makeMeta({
      reversibilityScores: { exec: 1.0 },
      requiresHuman: new Set(["exec"]),
    });
    const result = evaluateToolEnforcement({
      toolName: "exec",
      meta,
      actFirstEnabled: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("requires-human");
    }
  });
});

describe("wrapToolWithEnforcement", () => {
  it("returns tool unchanged when no execute function exists", () => {
    const tool = { name: "read-only" };
    const wrapped = wrapToolWithEnforcement(tool, makeMeta());
    expect(wrapped).toBe(tool);
  });

  it("passes through allowed tools", async () => {
    const execute = vi.fn().mockResolvedValue("ok");
    const wrapped = wrapToolWithEnforcement({ name: "read", execute }, makeMeta());
    // oxlint-disable-next-line typescript/no-explicit-any
    await expect((wrapped as any).execute("arg")).resolves.toBe("ok");
    expect(execute).toHaveBeenCalledWith("arg");
  });

  it("returns execution metadata for auto-run tools in act-first mode", async () => {
    const execute = vi.fn().mockResolvedValue("Read finished");
    const wrapped = wrapToolWithEnforcement(
      { name: "read", execute },
      makeMeta({ reversibilityScores: { read: 1.0 } }),
      { actFirstEnabled: true },
    );

    // oxlint-disable-next-line typescript/no-explicit-any
    await expect((wrapped as any).execute("arg")).resolves.toEqual({
      value: "Read finished",
      summary: "Read finished",
      undoAvailable: false,
    });
  });

  it("throws for blocked classic enforcement", () => {
    const execute = vi.fn();
    const wrapped = wrapToolWithEnforcement(
      { name: "delete", execute },
      makeMeta({ requiresHuman: new Set(["delete"]) }),
    );
    // oxlint-disable-next-line typescript/no-explicit-any
    expect(() => (wrapped as any).execute()).toThrow("human approval");
    expect(execute).not.toHaveBeenCalled();
  });

  it("requests approval for mid-score tools and executes on approval", async () => {
    const execute = vi.fn().mockResolvedValue("done");
    const surface: ApprovalSurface = {
      onApprovalRequest: vi.fn().mockResolvedValue(true),
    };
    const wrapped = wrapToolWithEnforcement(
      { name: "calendar_add", execute },
      makeMeta({ reversibilityScores: { calendar_add: 0.5 } }),
      { actFirstEnabled: true, approvalSurface: surface },
    );

    // oxlint-disable-next-line typescript/no-explicit-any
    await expect((wrapped as any).execute({ startsAt: "2026-04-03T14:00:00Z" })).resolves.toBe(
      "done",
    );
    expect(surface.onApprovalRequest).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects mid-score tools when approval is denied", async () => {
    const execute = vi.fn();
    const surface: ApprovalSurface = {
      onApprovalRequest: vi.fn().mockResolvedValue(false),
    };
    const wrapped = wrapToolWithEnforcement(
      { name: "calendar_add", execute },
      makeMeta({ reversibilityScores: { calendar_add: 0.5 } }),
      { actFirstEnabled: true, approvalSurface: surface },
    );

    // oxlint-disable-next-line typescript/no-explicit-any
    await expect((wrapped as any).execute({})).rejects.toThrow("approval denied or timed out");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects mid-score tools when no approval surface exists", () => {
    const execute = vi.fn();
    const wrapped = wrapToolWithEnforcement(
      { name: "calendar_add", execute },
      makeMeta({ reversibilityScores: { calendar_add: 0.5 } }),
      { actFirstEnabled: true },
    );

    // oxlint-disable-next-line typescript/no-explicit-any
    expect(() => (wrapped as any).execute({})).toThrow("no approval surface");
    expect(execute).not.toHaveBeenCalled();
  });

  it("requests approval for low-score tools and executes on approval", async () => {
    const execute = vi.fn().mockResolvedValue("email sent");
    const surface: ApprovalSurface = {
      onApprovalRequest: vi.fn().mockResolvedValue(true),
    };
    const wrapped = wrapToolWithEnforcement(
      { name: "email_send", execute },
      makeMeta({ reversibilityScores: { email_send: 0.2 } }),
      { actFirstEnabled: true, approvalSurface: surface },
    );

    // oxlint-disable-next-line typescript/no-explicit-any
    const result = await (wrapped as any).execute({});
    expect(surface.onApprovalRequest).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.value).toBe("email sent");
  });

  it("rejects low-score tools when approval is denied", async () => {
    const execute = vi.fn();
    const surface: ApprovalSurface = {
      onApprovalRequest: vi.fn().mockResolvedValue(false),
    };
    const wrapped = wrapToolWithEnforcement(
      { name: "email_send", execute },
      makeMeta({ reversibilityScores: { email_send: 0.2 } }),
      { actFirstEnabled: true, approvalSurface: surface },
    );

    // oxlint-disable-next-line typescript/no-explicit-any
    await expect((wrapped as any).execute({})).rejects.toThrow("approval denied or timed out");
    expect(execute).not.toHaveBeenCalled();
  });

  it("throws for low-score tools when no approval surface exists", () => {
    const execute = vi.fn();
    const wrapped = wrapToolWithEnforcement(
      { name: "email_send", execute },
      makeMeta({ reversibilityScores: { email_send: 0.2 } }),
      { actFirstEnabled: true },
    );

    // oxlint-disable-next-line typescript/no-explicit-any
    expect(() => (wrapped as any).execute({})).toThrow("no approval surface");
    expect(execute).not.toHaveBeenCalled();
  });

  it("notifies and registers undo for auto-run tools with undo metadata", async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue({
      value: { id: "evt-1" },
      summary: "Calendar event added",
      undo,
    });
    const surface: ApprovalSurface = {
      onApprovalRequest: vi.fn().mockResolvedValue(true),
      onAutoExecutionNotice: vi.fn().mockResolvedValue(undefined),
    };
    const undoRegistry = new InMemoryUndoRegistry();
    const wrapped = wrapToolWithEnforcement(
      { name: "calendar_add", execute },
      makeMeta({ reversibilityScores: { calendar_add: 0.8 } }),
      {
        actFirstEnabled: true,
        approvalSurface: surface,
        undoRegistry,
        undoScopeKey: "session-1",
      },
    );

    // oxlint-disable-next-line typescript/no-explicit-any
    const result = await (wrapped as any).execute({ startsAt: "2026-04-03T14:00:00Z" });
    expect(result.value).toEqual({ id: "evt-1" });
    expect(result.summary).toBe("Calendar event added");
    expect(result.undoAvailable).toBe(true);
    expect(typeof result.undoId).toBe("string");
    expect(surface.onAutoExecutionNotice).toHaveBeenCalledWith({
      toolName: "calendar_add",
      summary: "Calendar event added",
      undoAvailable: true,
      undoId: result.undoId,
    });

    const entry = undoRegistry.peekLast("session-1");
    expect(entry?.summary).toBe("Calendar event added");
    await undoRegistry.undoLast("session-1");
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
