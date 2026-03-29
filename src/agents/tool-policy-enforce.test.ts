import { describe, expect, it, vi } from "vitest";
import {
  evaluateToolEnforcement,
  wrapToolWithEnforcement,
  type RateLimitCallCounts,
} from "./tool-policy-enforce.js";
import type { ResolvedToolPolicyMeta } from "./tool-policy-pipeline.js";

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── requiresHuman (fail-closed) ───────────────────────────────────────────────

describe("evaluateToolEnforcement — requiresHuman", () => {
  it("blocks when tool is in requiresHuman and humanApproved is absent (fail-closed)", () => {
    const meta = makeMeta({ requiresHuman: new Set(["exec"]) });
    const result = evaluateToolEnforcement({ toolName: "exec", meta });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("requires-human");
  });

  it("blocks when tool is in requiresHuman and humanApproved is false (fail-closed)", () => {
    const meta = makeMeta({ requiresHuman: new Set(["exec"]) });
    const result = evaluateToolEnforcement({ toolName: "exec", meta, humanApproved: false });
    expect(result.allowed).toBe(false);
  });

  it("blocks when tool is in requiresHuman and humanApproved is undefined (fail-closed)", () => {
    const meta = makeMeta({ requiresHuman: new Set(["exec"]) });
    const result = evaluateToolEnforcement({ toolName: "exec", meta, humanApproved: undefined });
    expect(result.allowed).toBe(false);
  });

  it("allows when tool is in requiresHuman and humanApproved is true", () => {
    const meta = makeMeta({ requiresHuman: new Set(["exec"]) });
    const result = evaluateToolEnforcement({ toolName: "exec", meta, humanApproved: true });
    expect(result.allowed).toBe(true);
  });

  it("allows when tool is NOT in requiresHuman (regardless of humanApproved)", () => {
    const meta = makeMeta({ requiresHuman: new Set(["other"]) });
    const result = evaluateToolEnforcement({ toolName: "exec", meta });
    expect(result.allowed).toBe(true);
  });

  it("requiresHuman lookup uses normalized tool name (case-insensitive)", () => {
    // Meta stores "exec" (normalized); caller passes "EXEC"
    const meta = makeMeta({ requiresHuman: new Set(["exec"]) });
    const result = evaluateToolEnforcement({ toolName: "EXEC", meta });
    expect(result.allowed).toBe(false);
  });

  it("error message names the tool", () => {
    const meta = makeMeta({ requiresHuman: new Set(["delete"]) });
    const result = evaluateToolEnforcement({ toolName: "delete", meta });
    if (!result.allowed) expect(result.message).toContain("delete");
  });
});

// ── rate-limit ────────────────────────────────────────────────────────────────

describe("evaluateToolEnforcement — rate-limit", () => {
  it("allows when count is below perMinute limit", () => {
    const meta = makeMeta({ rateLimits: { exec: { perMinute: 5 } } });
    const counts = makeCountStore({ "exec:minute": 4 });
    const result = evaluateToolEnforcement({ toolName: "exec", meta, callCounts: counts });
    expect(result.allowed).toBe(true);
  });

  it("blocks when count meets perMinute limit (>= semantics)", () => {
    const meta = makeMeta({ rateLimits: { exec: { perMinute: 5 } } });
    const counts = makeCountStore({ "exec:minute": 5 });
    const result = evaluateToolEnforcement({ toolName: "exec", meta, callCounts: counts });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("rate-limit-exceeded");
      expect(result.message).toContain("5/5");
      expect(result.message).toContain("per minute");
    }
  });

  it("blocks when count exceeds perHour limit", () => {
    const meta = makeMeta({ rateLimits: { exec: { perHour: 10 } } });
    const counts = makeCountStore({ "exec:hour": 11 });
    const result = evaluateToolEnforcement({ toolName: "exec", meta, callCounts: counts });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toContain("per hour");
  });

  it("blocks when count meets perDay limit", () => {
    const meta = makeMeta({ rateLimits: { exec: { perDay: 100 } } });
    const counts = makeCountStore({ "exec:day": 100 });
    const result = evaluateToolEnforcement({ toolName: "exec", meta, callCounts: counts });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toContain("per day");
  });

  it("skips rate-limit check when callCounts is undefined", () => {
    const meta = makeMeta({ rateLimits: { exec: { perMinute: 1 } } });
    // No callCounts — limit is declared but not enforceable yet
    const result = evaluateToolEnforcement({ toolName: "exec", meta });
    expect(result.allowed).toBe(true);
  });

  it("rate-limit key uses normalized tool name (case-insensitive)", () => {
    const meta = makeMeta({ rateLimits: { exec: { perMinute: 3 } } });
    // counts keyed on normalized "exec"; caller passes "EXEC"
    const counts = makeCountStore({ "exec:minute": 3 });
    const result = evaluateToolEnforcement({ toolName: "EXEC", meta, callCounts: counts });
    expect(result.allowed).toBe(false);
  });

  it("allows tool with no rate-limit config regardless of counts", () => {
    const meta = makeMeta({ rateLimits: {} }); // no limits declared
    const counts = makeCountStore({ "exec:minute": 9999 });
    const result = evaluateToolEnforcement({ toolName: "exec", meta, callCounts: counts });
    expect(result.allowed).toBe(true);
  });
});

// ── requiresHuman takes priority over rate-limit ──────────────────────────────

describe("evaluateToolEnforcement — priority", () => {
  it("requiresHuman is checked before rate-limit — blocks with requires-human reason", () => {
    const meta = makeMeta({
      requiresHuman: new Set(["exec"]),
      rateLimits: { exec: { perMinute: 1 } },
    });
    const counts = makeCountStore({ "exec:minute": 999 });
    const result = evaluateToolEnforcement({ toolName: "exec", meta, callCounts: counts });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("requires-human");
  });
});

// ── wrapToolWithEnforcement ───────────────────────────────────────────────────

describe("wrapToolWithEnforcement", () => {
  it("returns tool unchanged when it has no execute function", () => {
    const tool = { name: "read-only" };
    const meta = makeMeta({ requiresHuman: new Set(["read-only"]) });
    const wrapped = wrapToolWithEnforcement(tool, meta);
    expect(wrapped).toBe(tool); // same reference, no wrapping
  });

  it("allowed tool calls through to original execute", async () => {
    const execute = vi.fn().mockResolvedValue("ok");
    const tool = { name: "read", execute };
    const meta = makeMeta(); // no requiresHuman, no rate-limit
    const wrapped = wrapToolWithEnforcement(tool, meta);
    // oxlint-disable-next-line typescript/no-explicit-any
    const result = await (wrapped as any).execute("arg1");
    expect(result).toBe("ok");
    expect(execute).toHaveBeenCalledWith("arg1");
  });

  it("blocked tool throws on execute (requiresHuman, humanApproved hardcoded false)", () => {
    const execute = vi.fn();
    const tool = { name: "delete", execute };
    const meta = makeMeta({ requiresHuman: new Set(["delete"]) });
    const wrapped = wrapToolWithEnforcement(tool, meta);
    // oxlint-disable-next-line typescript/no-explicit-any
    expect(() => (wrapped as any).execute()).toThrow("human approval");
    expect(execute).not.toHaveBeenCalled();
  });

  it("agent path never self-approves — humanApproved is always false in wrapper", () => {
    // Even if somehow called with extra args, the decision must be blocked
    const execute = vi.fn();
    const tool = { name: "exec", execute };
    const meta = makeMeta({ requiresHuman: new Set(["exec"]) });
    const wrapped = wrapToolWithEnforcement(tool, meta);
    // oxlint-disable-next-line typescript/no-explicit-any
    expect(() => (wrapped as any).execute("call-id", {})).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("forwards all arguments to original execute when allowed", async () => {
    const execute = vi.fn().mockReturnValue("result");
    const tool = { name: "read", execute };
    const meta = makeMeta();
    const wrapped = wrapToolWithEnforcement(tool, meta);
    // oxlint-disable-next-line typescript/no-explicit-any
    (wrapped as any).execute("id-1", { path: "/tmp" });
    expect(execute).toHaveBeenCalledWith("id-1", { path: "/tmp" });
  });
});
