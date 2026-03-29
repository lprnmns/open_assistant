import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRateLimitStore, getSessionRateLimitStore } from "./tool-policy-rate-limit-store.js";

// ── InMemoryRateLimitStore ─────────────────────────────────────────────────────

describe("InMemoryRateLimitStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("getCount returns 0 for an unknown tool", () => {
    const store = new InMemoryRateLimitStore();
    expect(store.getCount("unknown_tool", "minute")).toBe(0);
  });

  it("record + getCount increments within the same window", () => {
    const store = new InMemoryRateLimitStore();
    store.record("exec");
    store.record("exec");
    expect(store.getCount("exec", "minute")).toBe(2);
  });

  it("getCount excludes timestamps older than the window", () => {
    const store = new InMemoryRateLimitStore();
    store.record("exec"); // t = 0
    vi.advanceTimersByTime(61_000); // 61 s — outside 1-minute window
    store.record("exec"); // t = 61 s
    // Only the second call is within the minute window
    expect(store.getCount("exec", "minute")).toBe(1);
  });

  it("different windows slice the same timestamps differently", () => {
    const store = new InMemoryRateLimitStore();
    // Record 3 calls spread over 2 hours
    store.record("send");
    vi.advanceTimersByTime(30 * 60_000); // +30 min
    store.record("send");
    vi.advanceTimersByTime(31 * 60_000); // +31 min (total 61 min)
    store.record("send");

    // Only the last call is within the minute window
    expect(store.getCount("send", "minute")).toBe(1);
    // All 3 calls are within the hour window (61 min < 1 h... wait, 61 min > 1 h)
    // Actually 61 min > 60 min — only last 2 are within the hour
    expect(store.getCount("send", "hour")).toBe(2);
    // All 3 within the day window
    expect(store.getCount("send", "day")).toBe(3);
  });

  it("record normalizes tool name (case-insensitive)", () => {
    const store = new InMemoryRateLimitStore();
    store.record("EXEC");
    expect(store.getCount("exec", "minute")).toBe(1);
  });

  it("getCount normalizes tool name (case-insensitive)", () => {
    const store = new InMemoryRateLimitStore();
    store.record("exec");
    expect(store.getCount("EXEC", "minute")).toBe(1);
  });

  it("prunes stale timestamps on getCount (memory bounded)", () => {
    const store = new InMemoryRateLimitStore();
    store.record("exec");
    vi.advanceTimersByTime(86_401_000); // > 1 day
    // Should prune the stale entry and return 0
    expect(store.getCount("exec", "day")).toBe(0);
  });

  it("independent tools do not share counts", () => {
    const store = new InMemoryRateLimitStore();
    store.record("read");
    store.record("read");
    store.record("write");
    expect(store.getCount("read", "minute")).toBe(2);
    expect(store.getCount("write", "minute")).toBe(1);
  });
});

// ── getSessionRateLimitStore ───────────────────────────────────────────────────

describe("getSessionRateLimitStore", () => {
  it("returns the same store instance for the same session key", () => {
    const s1 = getSessionRateLimitStore("session-abc");
    const s2 = getSessionRateLimitStore("session-abc");
    expect(s1).toBe(s2);
  });

  it("returns different stores for different session keys", () => {
    const s1 = getSessionRateLimitStore("session-x");
    const s2 = getSessionRateLimitStore("session-y");
    expect(s1).not.toBe(s2);
  });

  it("counts recorded via store persist across getSessionRateLimitStore calls", () => {
    vi.useFakeTimers();
    const key = `session-persist-${Date.now()}`;
    const s1 = getSessionRateLimitStore(key);
    s1.record("exec");
    const s2 = getSessionRateLimitStore(key);
    expect(s2.getCount("exec", "minute")).toBe(1);
    vi.useRealTimers();
  });
});

// ── Integration: blocking on nth+1 call ───────────────────────────────────────

describe("InMemoryRateLimitStore — integration with evaluateToolEnforcement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows calls up to the limit and blocks on the nth+1 call", async () => {
    const { evaluateToolEnforcement } = await import("./tool-policy-enforce.js");
    const store = new InMemoryRateLimitStore();
    const meta = {
      reversibilityScores: {},
      requiresHuman: new Set<string>(),
      rateLimits: { exec: { perMinute: 3 } },
    };

    // First 3 calls should pass and be recorded
    for (let i = 0; i < 3; i++) {
      const result = evaluateToolEnforcement({ toolName: "exec", meta, callCounts: store });
      expect(result.allowed).toBe(true);
      store.record("exec");
    }

    // 4th call should be blocked
    const blocked = evaluateToolEnforcement({ toolName: "exec", meta, callCounts: store });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toBe("rate-limit-exceeded");
      expect(blocked.message).toContain("3/3");
      expect(blocked.message).toContain("per minute");
    }
  });

  it("resets after the window expires", async () => {
    const { evaluateToolEnforcement } = await import("./tool-policy-enforce.js");
    const store = new InMemoryRateLimitStore();
    const meta = {
      reversibilityScores: {},
      requiresHuman: new Set<string>(),
      rateLimits: { exec: { perMinute: 2 } },
    };

    // Hit the limit
    store.record("exec");
    store.record("exec");
    const blocked = evaluateToolEnforcement({ toolName: "exec", meta, callCounts: store });
    expect(blocked.allowed).toBe(false);

    // Advance past the minute window
    vi.advanceTimersByTime(61_000);

    // Should be allowed again
    const allowed = evaluateToolEnforcement({ toolName: "exec", meta, callCounts: store });
    expect(allowed.allowed).toBe(true);
  });
});
